#!/usr/bin/env python3
"""Serve Git smart-HTTP with token auth, for the HTTPS-token device row.

Complements `test-ssh-git-server.py`: the SSH rows prove key auth, this proves
the token path — including that the token is never echoed back to the client.

Runs `git http-backend` per request and requires HTTP Basic auth whose password
equals the token in $LEO_HTTP_TOKEN for user $LEO_HTTP_USER (default:
"x-access-token", the same default the Git engine uses). A wrong token gets 401
so a failure is unambiguous.

    LEO_HTTP_TOKEN=... /tmp/pf-venv/bin/python scripts/test-git-http-server.py

Paths come from the environment:
    LEO_HTTP_BASE   base directory (default /tmp/pf-ssh)
    LEO_HTTP_ROOT   repositories directory (default <base>/srv)
    LEO_HTTP_PORT   port (default 8080)
    LEO_HTTP_HOST   bind address (default 0.0.0.0 so a device on the LAN can reach it)

Never logs the token; only whether auth succeeded.
"""
import base64
import os
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.environ.get("LEO_HTTP_BASE", "/tmp/pf-ssh")
ROOT = os.environ.get("LEO_HTTP_ROOT", os.path.join(BASE, "srv"))
PORT = int(os.environ.get("LEO_HTTP_PORT", "8080"))
HOST = os.environ.get("LEO_HTTP_HOST", "0.0.0.0")
USER = os.environ.get("LEO_HTTP_USER", "x-access-token")
TOKEN = os.environ.get("LEO_HTTP_TOKEN", "")
LOG = os.path.join(BASE, "http.log")


def log(line):
    with open(LOG, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


class GitHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _authorized(self):
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return False
        try:
            decoded = base64.b64decode(header[6:]).decode("utf-8", "replace")
        except Exception:
            return False
        got_user, _, got_token = decoded.partition(":")
        # Compare both fields; never log either.
        return got_user == USER and TOKEN and got_token == TOKEN

    def _unauthorized(self):
        log(f"{self.command} {self.path} -> 401 (bad or missing credentials)")
        body = b"authentication required\n"
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="leocode-test"')
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _run(self, method):
        if not self._authorized():
            self._unauthorized()
            return

        path = self.path.split("?", 1)[0]
        query = self.path.split("?", 1)[1] if "?" in self.path else ""
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""

        env = dict(os.environ)
        # `git http-backend` reads the wire protocol version from the
        # GIT_PROTOCOL environment variable, not from HTTP_GIT_PROTOCOL — the
        # CGI header convention does not apply here (Apache maps it explicitly
        # with SetEnvIf). Without this, JGit's `Git-Protocol: version=2`
        # advertises v2 on the ref discovery GET but the follow-up POST is
        # answered by a v0 backend, which returns an empty body and the clone
        # fails. The SSH server needs the same variable, and already sets it.
        env.update(
            {
                "GIT_PROJECT_ROOT": ROOT,
                "GIT_HTTP_EXPORT_ALL": "1",
                "GIT_PROTOCOL": self.headers.get("Git-Protocol", ""),
                "REQUEST_METHOD": method,
                "PATH_INFO": path,
                "QUERY_STRING": query,
                "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                "CONTENT_LENGTH": str(length),
                "REMOTE_USER": USER,
                "REMOTE_ADDR": self.client_address[0],
                "HTTP_GIT_PROTOCOL": self.headers.get("Git-Protocol", ""),
                "SERVER_PROTOCOL": "HTTP/1.1",
                "SERVER_NAME": "leocode-test",
                "SERVER_PORT": str(PORT),
                "GATEWAY_INTERFACE": "CGI/1.1",
            }
        )
        proc = subprocess.run(
            ["git", "http-backend"], input=body, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )

        raw = proc.stdout
        head, _, payload = raw.partition(b"\r\n\r\n")
        if not payload:
            head, _, payload = raw.partition(b"\n\n")

        status = 200
        headers = []
        for line in head.replace(b"\r\n", b"\n").split(b"\n"):
            if not line.strip():
                continue
            name, _, value = line.decode("latin-1").partition(":")
            if name.strip().lower() == "status":
                status = int(value.strip().split()[0])
            else:
                headers.append((name.strip(), value.strip()))

        log(f"{method} {self.path} -> {status} ({len(payload)}B) user={USER}")

        self.send_response(status)
        for name, value in headers:
            if name.lower() in ("content-length", "connection", "transfer-encoding"):
                continue
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        self._run("GET")

    def do_POST(self):
        self._run("POST")

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    if not TOKEN:
        print("ERROR: set LEO_HTTP_TOKEN", file=sys.stderr, flush=True)
        raise SystemExit(2)
    server = ThreadingHTTPServer((HOST, PORT), GitHandler)
    print(f"READY {PORT} root={ROOT} user={USER}", flush=True)
    log(f"--- start {PORT} root={ROOT} user={USER}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
