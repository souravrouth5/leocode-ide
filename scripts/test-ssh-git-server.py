#!/usr/bin/env python3
"""Serve Git repositories over SSH, for LeoCode's T12/T13 device tests.

The Phase F rows T12 (SSH clone) and T13 (push) need an SSH remote the device
can reach and that we control, so the public key the *device* generates can be
authorised and the host key can be rotated to exercise the changed-key policy.
GitHub needs an account and a key upload per run; this server needs neither.

Behaviour
---------
* Host key: ed25519, generated and persisted on first run under --base-dir.
* Auth: a public key that appears in <base>/authorized_keys, or the fixed
  password "leocode-test" for user "git" (handy for a smoke test before the
  device key exists). Which method was used is logged.
* Accepts exec requests of the form `git-upload-pack '<path>'` and
  `git-receive-pack '<path>'`, quoted or not. A leading "/" is stripped and the
  path is resolved under <base>/srv; anything escaping that directory is
  rejected with exit status 1.
* Spawns the real `git upload-pack` / `git receive-pack` with stdin/stdout wired
  to the channel, stderr forwarded, and the child's exit status propagated.
* pty / shell / sftp / port forwarding are rejected.
* Prints "READY <port>" once listening. No key material is ever logged.

Setup
-----
    python3 -m venv /tmp/pf-venv
    /tmp/pf-venv/bin/pip install paramiko

    # one bare repo to clone from, one to push to
    mkdir -p /tmp/leocode-ssh/srv
    git init --bare /tmp/leocode-ssh/srv/t12.git
    git init --bare /tmp/leocode-ssh/srv/t13.git

Run (bind on all interfaces so the device can reach it over the LAN):
    /tmp/pf-venv/bin/python scripts/test-ssh-git-server.py

Then, in the harness, point at this host and port:
    adb shell am start -n dev.leocode/.HarnessActivity --es run T12 \
        --es sshHost <host-lan-ip> --es sshPort 2222

T11 mints a fresh key each run, so append the public key it prints to
<base>/authorized_keys before running T12/T13:

    adb logcat -d -s LeoCodeHarness:I | grep publicKey=
    ssh-keygen -lf <base>/authorized_keys   # cross-check the fingerprint

Stop: Ctrl-C, or `kill $(cat <base>/server.pid)`.

The device's third-party VPN must be off: with it active no app-UID socket
works, so T12/T13 fail regardless of LeoCode.
"""

import errno
import logging
import os
import re
import shlex
import socket
import subprocess
import sys
import threading
import time

import paramiko
from paramiko.ssh_exception import SSHException

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
BASE_DIR = os.environ.get("LEO_SSH_BASE", "/tmp/leocode-ssh")
HOST_KEY_PATH = os.path.join(BASE_DIR, "host_ed25519")
AUTHORIZED_KEYS = os.path.join(BASE_DIR, "authorized_keys")
SERVER_ROOT = os.environ.get("LEO_SSH_ROOT", os.path.join(BASE_DIR, "srv"))
LOG_PATH = os.path.join(BASE_DIR, "server.log")
PID_PATH = os.path.join(BASE_DIR, "server.pid")

BIND_HOST = os.environ.get("LEO_SSH_HOST", "0.0.0.0")
BIND_PORT = int(os.environ.get("LEO_SSH_PORT", "2222"))
GIT_USER = "git"
PASSWORD = "leocode-test"  # fallback smoke-test password for user "git"

# How long to wait for the git child before we start closing things down.
CHILD_GRACE_SECONDS = 30.0

# --------------------------------------------------------------------------- #
# Logging (never log key material)
# --------------------------------------------------------------------------- #
log = logging.getLogger("test-ssh-git-server")
log.setLevel(logging.INFO)
log.propagate = False
_fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%Y-%m-%d %H:%M:%S")
_fh = logging.FileHandler(LOG_PATH, encoding="utf-8")
_fh.setFormatter(_fmt)
log.addHandler(_fh)
_sh = logging.StreamHandler(sys.stderr)
_sh.setFormatter(_fmt)
log.addHandler(_sh)


# --------------------------------------------------------------------------- #
# Host key
# --------------------------------------------------------------------------- #
def _generate_ed25519_keyfile(path):
    """Create a new ed25519 private key on disk at `path` (OpenSSH format)."""
    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ed25519

        priv = ed25519.Ed25519PrivateKey.generate()
        pem = priv.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.OpenSSH,
            encryption_algorithm=serialization.NoEncryption(),
        )
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(pem)
        return
    except Exception as exc:
        log.warning("cryptography-based key generation failed (%s); falling back to ssh-keygen", exc)

    rc = subprocess.run(
        ["ssh-keygen", "-t", "ed25519", "-N", "", "-C", "pf-ssh-host", "-f", path],
        capture_output=True,
    )
    if rc.returncode != 0:
        raise RuntimeError(
            "could not generate ed25519 host key: " + rc.stderr.decode(errors="replace")
        )


def load_or_create_host_key():
    """Return an Ed25519Key, generating and persisting it if absent."""
    os.makedirs(BASE_DIR, mode=0o700, exist_ok=True)
    if os.path.exists(HOST_KEY_PATH):
        try:
            key = paramiko.Ed25519Key(filename=HOST_KEY_PATH)
            os.chmod(HOST_KEY_PATH, 0o600)
            _write_pub_sidecar(key)
            log.info("loaded existing host key %s fingerprint=%s", HOST_KEY_PATH, fingerprint(key))
            return key
        except Exception as exc:  # corrupt / unreadable -> regenerate
            log.warning("could not load host key %s (%s); regenerating", HOST_KEY_PATH, exc)

    _generate_ed25519_keyfile(HOST_KEY_PATH)
    os.chmod(HOST_KEY_PATH, 0o600)

    key = paramiko.Ed25519Key(filename=HOST_KEY_PATH)
    _write_pub_sidecar(key)

    # Verify round-trip.
    check = paramiko.Ed25519Key(filename=HOST_KEY_PATH)
    assert check.get_base64() == key.get_base64(), "host key did not persist correctly"
    log.info("generated new ed25519 host key %s fingerprint=%s", HOST_KEY_PATH, fingerprint(key))
    return key


def _write_pub_sidecar(key):
    """Write the .pub file next to the private key so ssh-keygen -lf works."""
    pub_path = HOST_KEY_PATH + ".pub"
    want = f"{key.get_name()} {key.get_base64()} pf-ssh-host\n"
    try:
        if os.path.exists(pub_path):
            with open(pub_path, "r", encoding="utf-8") as fh:
                if fh.read() == want:
                    return
        with open(pub_path, "w", encoding="utf-8") as fh:
            fh.write(want)
        os.chmod(pub_path, 0o644)
    except Exception as exc:
        log.warning("could not write %s: %s", pub_path, exc)


def fingerprint(key):
    """OpenSSH-style SHA256 fingerprint, computed without logging key material."""
    import base64
    import hashlib

    # key.asbytes() is the SSH wire-format public key blob, which is exactly
    # what `ssh-keygen -l` hashes.
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode().rstrip("=")


# --------------------------------------------------------------------------- #
# authorized_keys
# --------------------------------------------------------------------------- #
def load_authorized_keys():
    """Parse authorized_keys -> list of (type, base64blob) tuples.

    Accepts plain public-key lines as produced by ssh-keygen, and tolerates
    leading options (anything before the key type) plus trailing comments.
    """
    entries = []
    if not os.path.exists(AUTHORIZED_KEYS):
        return entries
    with open(AUTHORIZED_KEYS, "r", encoding="utf-8", errors="replace") as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("ssh-") or line.startswith("ecdsa-") or line.startswith("sk-"):
                parts = line.split()
            else:
                # strip leading authorized_keys options
                m = re.search(r"(ssh-[A-Za-z0-9@.\-]+|ecdsa-[A-Za-z0-9@.\-]+)\s+(\S+)", line)
                if not m:
                    log.warning("authorized_keys:%d: unparseable line, ignored", lineno)
                    continue
                parts = [m.group(1), m.group(2)]
            if len(parts) < 2:
                log.warning("authorized_keys:%d: unparseable line, ignored", lineno)
                continue
            entries.append((parts[0], parts[1]))
    return entries


# --------------------------------------------------------------------------- #
# Git command parsing / path resolution
# --------------------------------------------------------------------------- #
EXEC_RE = re.compile(
    r"""^\s*(?P<service>git-upload-pack|git-receive-pack|git-upload-archive)\s+(?P<arg>.+?)\s*$"""
)


def parse_git_command(command):
    """Parse 'git-upload-pack '<path>'' -> (service, path) or raise ValueError."""
    if isinstance(command, (bytes, bytearray)):
        command = bytes(command).decode("utf-8", "replace")
    m = EXEC_RE.match(command or "")
    if not m:
        raise ValueError("unsupported command")
    service = m.group("service")
    arg = m.group("arg").strip()
    if not arg:
        raise ValueError("missing repository path")
    # Unquote: shlex handles 'path', "path", and bare path; it also tolerates
    # stray escaping. Postel-style: if shlex trips over quotes, strip them.
    try:
        parts = shlex.split(arg)
    except ValueError:
        parts = [arg.strip("'\"")]
    path = " ".join(parts).strip() if parts else arg.strip("'\"")
    if path.startswith("'"):
        path = path.strip("'")
    if path.startswith('"'):
        path = path.strip('"')
    if not path:
        raise ValueError("missing repository path")
    return service, path


def resolve_repo_path(requested):
    """Map a client-requested path onto SERVER_ROOT.

    Strips leading '/', rejects traversal outside SERVER_ROOT.
    Returns the resolved absolute path (which may not exist yet -> git errors).
    """
    cleaned = requested
    while cleaned.startswith("/"):
        cleaned = cleaned[1:]
    # "~/" style git URLs: ssh://host/~/repo.git
    if cleaned.startswith("~/"):
        cleaned = cleaned[2:]

    root = os.path.realpath(SERVER_ROOT)
    if ".." in cleaned.replace("\\", "/").split("/"):
        raise ValueError("path escapes server root")
    candidate = os.path.realpath(os.path.join(root, cleaned))

    if candidate != root and not candidate.startswith(root + os.sep):
        raise ValueError("path escapes server root")
    return candidate


def is_repo(path):
    if not os.path.isdir(path):
        return False
    if os.path.isfile(os.path.join(path, "HEAD")) and (
        os.path.isdir(os.path.join(path, "objects")) or os.path.isfile(os.path.join(path, "commondir"))
    ):
        return True
    return False


# --------------------------------------------------------------------------- #
# ServerInterface
# --------------------------------------------------------------------------- #
class GitSSHServer(paramiko.ServerInterface):
    def __init__(self, conn_id, peer, host_key):
        self.conn_id = conn_id
        self.peer = peer
        self.host_key = host_key
        self.username = None
        self.auth_method = None
        self.env = {}
        self._logged_key = None
        self.exec_event = threading.Event()
        self.exec_command = None
        self.exec_channel = None
        self.exit_status = None

    # -- auth ------------------------------------------------------------- #
    def get_allowed_auths(self, username):
        return "publickey,password"

    def get_banner(self):
        return ("LeoCode test SSH git server\n", "en")

    def check_auth_publickey(self, username, key):
        entries = load_authorized_keys()
        presented_type = key.get_name()
        presented_b64 = key.get_base64()
        for ktype, kblob in entries:
            if kblob == presented_b64:
                self.username = username
                self.auth_method = "publickey"
                # paramiko calls this twice (query + signed attempt); log once.
                if self._logged_key != presented_b64:
                    self._logged_key = presented_b64
                    log.info(
                        "conn=%s auth OK user=%r method=publickey keytype=%s fingerprint=%s",
                        self.conn_id, username, presented_type, fingerprint(key),
                    )
                return paramiko.AUTH_SUCCESSFUL
        if self._logged_key != presented_b64:
            self._logged_key = presented_b64
            log.warning(
                "conn=%s auth FAILED user=%r method=publickey keytype=%s fingerprint=%s "
                "(not in %s; %d authorized key(s))",
                self.conn_id, username, presented_type, fingerprint(key),
                AUTHORIZED_KEYS, len(entries),
            )
        return paramiko.AUTH_FAILED

    def check_auth_password(self, username, password):
        if username == GIT_USER and password == PASSWORD:
            self.username = username
            self.auth_method = "password"
            log.info("conn=%s auth OK user=%r method=password", self.conn_id, username)
            return paramiko.AUTH_SUCCESSFUL
        self.auth_method = None
        log.warning("conn=%s auth FAILED user=%r method=password", self.conn_id, username)
        return paramiko.AUTH_FAILED

    # -- channels --------------------------------------------------------- #
    def check_channel_request(self, kind, chanid):
        if kind == "session":
            log.info("conn=%s channel request kind=session chanid=%s -> accepted", self.conn_id, chanid)
            return paramiko.OPEN_SUCCEEDED
        log.warning("conn=%s channel request kind=%s chanid=%s -> rejected", self.conn_id, kind, chanid)
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_exec_request(self, channel, command):
        # paramiko 5.x hands us the raw bytes of the request.
        if isinstance(command, (bytes, bytearray)):
            command = bytes(command).decode("utf-8", "replace")
        log.info("conn=%s exec request: %r", self.conn_id, command)
        self.exec_command = command
        self.exec_channel = channel
        self.exec_event.set()
        return True  # accepted; the worker performs validation + spawns git

    def check_channel_pty_request(self, channel, term, width, height, pixelwidth, pixelheight, modes):
        log.warning("conn=%s pty request rejected", self.conn_id)
        return False

    def check_channel_shell_request(self, channel):
        log.warning("conn=%s shell request rejected", self.conn_id)
        return False

    def check_channel_subsystem_request(self, channel, name):
        log.warning("conn=%s subsystem request %r rejected", self.conn_id, name)
        return False

    def check_channel_env_request(self, channel, name, value):
        # Git sends GIT_PROTOCOL=version=2 here. Remember and pass it through so
        # protocol v2 works (JGit negotiates the same way over ssh).
        try:
            if isinstance(name, (bytes, bytearray)):
                name = bytes(name).decode("utf-8", "replace")
            if isinstance(value, (bytes, bytearray)):
                value = bytes(value).decode("utf-8", "replace")
        except Exception:
            return False
        self.env[name] = value
        log.info("conn=%s env request %r=%r accepted", self.conn_id, name, value)
        return True

    def check_channel_window_change_request(self, channel, width, height, pixelwidth, pixelheight):
        return True

    def check_port_forward_request(self, address, port):
        log.warning("conn=%s port forward request rejected", self.conn_id)
        return False

    def check_channel_direct_tcpip_request(self, chanid, origin, destination):
        log.warning("conn=%s direct-tcpip request rejected", self.conn_id)
        return paramiko.OPEN_FAILED_ADMINISTRATIVELY_PROHIBITED

    def check_channel_forward_agent_request(self, channel):
        return False

    # -- git execution ---------------------------------------------------- #
    def run_git(self, channel):
        try:
            service, requested = parse_git_command(self.exec_command)
        except ValueError as exc:
            msg = f"pf-ssh: unsupported command ({exc})\n"
            log.warning("conn=%s exec rejected: %s", self.conn_id, exc)
            self._fail(channel, msg)
            return

        try:
            repo = resolve_repo_path(requested)
        except ValueError as exc:
            msg = f"pf-ssh: repository path rejected: {exc}\n"
            log.warning("conn=%s path rejected %r: %s", self.conn_id, requested, exc)
            self._fail(channel, msg)
            return

        log.info(
            "conn=%s exec=%s requested_path=%r resolved=%r exists=%s is_repo=%s",
            self.conn_id, service, requested, repo, os.path.exists(repo), is_repo(repo),
        )

        if not is_repo(repo):
            msg = f"pf-ssh: not a git repository: {requested}\n"
            log.warning("conn=%s not a repo: %s", self.conn_id, repo)
            self._fail(channel, msg)
            return

        subcmd = service[len("git-"):]  # "upload-pack" / "receive-pack" / "upload-archive"
        argv = ["/usr/bin/git", subcmd, repo]
        env = dict(os.environ)
        env.update({
            # receive-pack is spawned inside a bare repo; keep this permissive so
            # the test server works regardless of directory ownership.
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "safe.directory",
            "GIT_CONFIG_VALUE_0": "*",
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "HOME": BASE_DIR,
            "LC_ALL": "C",
        })
        # GIT_DIR must NOT be set: git derives it from cwd/argv.
        env.pop("GIT_DIR", None)
        # Pass through env requests the client sent (notably GIT_PROTOCOL=v2).
        for name, value in self.env.items():
            if name in ("GIT_PROTOCOL", "LANG", "LC_ALL"):
                env[name] = value
        if env.get("GIT_PROTOCOL"):
            log.info("conn=%s passing GIT_PROTOCOL=%r to git", self.conn_id, env["GIT_PROTOCOL"])

        try:
            proc = subprocess.Popen(
                argv,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=repo,
                env=env,
                close_fds=True,
            )
        except Exception as exc:
            log.error("conn=%s failed to spawn %s: %s", self.conn_id, argv, exc)
            self._fail(channel, f"pf-ssh: failed to start {service}: {exc}\n")
            return

        log.info("conn=%s spawned pid=%s argv=%s", self.conn_id, proc.pid, argv)

        # child stdout -> channel
        def pump_out():
            # os.read on the raw fd returns as soon as ANY bytes are available
            # (BufferedReader.read(n) would block for a full n bytes, which
            # deadlocks interactive protocols like upload-pack).
            fd = proc.stdout.fileno()
            try:
                while True:
                    data = os.read(fd, 32768)
                    if not data:
                        break
                    channel.sendall(data)
            except Exception as exc:
                log.info("conn=%s stdout pump ended: %s", self.conn_id, exc)

        # channel stdin -> child stdin
        def pump_in():
            try:
                while True:
                    data = channel.recv(32768)
                    if not data:
                        break
                    proc.stdin.write(data)
                    proc.stdin.flush()
            except Exception as exc:
                log.info("conn=%s stdin pump ended: %s", self.conn_id, exc)
            finally:
                try:
                    proc.stdin.close()
                except Exception:
                    pass

        # child stderr -> channel stderr
        def pump_err():
            fd = proc.stderr.fileno()
            try:
                while True:
                    data = os.read(fd, 32768)
                    if not data:
                        break
                    channel.sendall_stderr(data)
            except Exception as exc:
                log.info("conn=%s stderr pump ended: %s", self.conn_id, exc)

        threads = [
            threading.Thread(target=pump_out, daemon=True),
            threading.Thread(target=pump_in, daemon=True),
            threading.Thread(target=pump_err, daemon=True),
        ]
        for t in threads:
            t.start()

        rc = proc.wait()
        threads[0].join(CHILD_GRACE_SECONDS)
        threads[2].join(CHILD_GRACE_SECONDS)
        self.exit_status = rc
        log.info("conn=%s %s exited rc=%s", self.conn_id, service, rc)

        # Make sure stdout is fully drained before we send exit-status/close.
        try:
            channel.shutdown_write()
        except Exception:
            pass
        try:
            channel.send_exit_status(rc)
        except Exception:
            try:
                channel.send_exit_status(255 if rc < 0 else rc)
            except Exception:
                pass
        log.info("conn=%s exec finished exit_status=%s", self.conn_id, self.exit_status)
        try:
            channel.close()
        except Exception:
            pass

    def _fail(self, channel, message):
        self.exit_status = 1
        try:
            channel.sendall_stderr(message.encode())
        except Exception:
            pass
        try:
            channel.send_exit_status(1)
        except Exception:
            pass
        log.info("conn=%s exec finished exit_status=1", self.conn_id)
        try:
            channel.close()
        except Exception:
            pass


# --------------------------------------------------------------------------- #
# Connection handler
# --------------------------------------------------------------------------- #
def handle_connection(client_sock, addr, host_key, conn_id):
    peer = f"{addr[0]}:{addr[1]}"
    log.info("conn=%s CONNECT peer=%s", conn_id, peer)
    transport = paramiko.Transport(client_sock)
    transport.local_version = "SSH-2.0-pf_ssh_git_1.0"
    transport.add_server_key(host_key)
    # No subsystem handlers are registered on purpose: sftp and friends are rejected.
    server = GitSSHServer(conn_id, peer, host_key)
    try:
        transport.start_server(server=server)
    except (SSHException, EOFError, socket.error) as exc:
        log.info("conn=%s ssh handshake ended: %s", conn_id, exc)
        transport.close()
        return

    log.info("conn=%s authenticated user=%r method=%s", conn_id, server.username, server.auth_method)

    try:
        # Wait for an exec request (or transport death), whichever comes first.
        while transport.is_active() and not server.exec_event.is_set():
            server.exec_event.wait(0.1)
        if not server.exec_event.is_set():
            log.info("conn=%s closed without exec request", conn_id)
            return
        server.run_git(server.exec_channel)
        # Give the transport a moment to flush pending output to the client.
        deadline = time.time() + 5.0
        while transport.is_active() and time.time() < deadline:
            time.sleep(0.05)
    except Exception as exc:
        log.exception("conn=%s handler error: %s", conn_id, exc)
    finally:
        try:
            transport.close()
        except Exception:
            pass
        log.info("conn=%s DISCONNECT peer=%s auth=%s exit_status=%s",
                 conn_id, peer, server.auth_method, server.exit_status)


def main():
    os.makedirs(SERVER_ROOT, exist_ok=True)
    os.makedirs(BASE_DIR, mode=0o700, exist_ok=True)
    if not os.path.exists(AUTHORIZED_KEYS):
        open(AUTHORIZED_KEYS, "a", encoding="utf-8").close()

    host_key = load_or_create_host_key()
    log.info("listening on %s:%d root=%s authorized_keys=%s",
             BIND_HOST, BIND_PORT, SERVER_ROOT, AUTHORIZED_KEYS)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind((BIND_HOST, BIND_PORT))
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            print(f"ERROR: {BIND_HOST}:{BIND_PORT} already in use", file=sys.stderr, flush=True)
        raise
    sock.listen(64)

    with open(PID_PATH, "w", encoding="utf-8") as fh:
        fh.write(str(os.getpid()))

    print(f"READY {BIND_PORT}", flush=True)
    log.info("READY %d pid=%d fingerprint=%s", BIND_PORT, os.getpid(), fingerprint(host_key))

    conn_id = 0
    try:
        while True:
            try:
                client_sock, addr = sock.accept()
            except OSError as exc:
                log.warning("accept failed: %s", exc)
                continue
            conn_id += 1
            t = threading.Thread(
                target=handle_connection,
                args=(client_sock, addr, host_key, conn_id),
                daemon=True,
                name=f"conn-{conn_id}",
            )
            t.start()
    except KeyboardInterrupt:
        log.info("shutting down (KeyboardInterrupt)")
    finally:
        try:
            sock.close()
        except Exception:
            pass
        try:
            os.unlink(PID_PATH)
        except Exception:
            pass
        log.info("server stopped")


if __name__ == "__main__":
    main()
