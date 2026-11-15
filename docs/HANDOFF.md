# Handoff — LeoCode state at the end of the Phase F session (2026-11-15)

Written for whoever picks this up next. It records what is done, what is open, how to reproduce
the verification, and the traps that cost time this session. The task tracker (`PROGRESS.md`) and
[`reports/phase-f-verification.md`](reports/phase-f-verification.md) remain the source of truth;
this file is the orientation layer.

## Where the work is

| Item | State |
|---|---|
| Branch | `v9-impl`, in `/home/sourav/Desktop/Apps/leocode` (the main worktree) |
| Commits this session | `993d4ad`, `69de290`, `560a4aa`, `2c4a2ac`, `fb675a4`, `7449d6b`, `cad1450`, `05dae96`, `9469b5c` |
| Remote | `origin/v9-impl` matches local `HEAD`; nothing outstanding to push |
| Worktrees | `phase-f-core`, `phase-f-web`, `phase-f-docs` are **merged**; they still exist on disk and can be cleaned up |
| Working tree | Clean |
| Gates | Android 357 unit tests, `lintDebug`, `assembleDebug`; web 277 tests in 40 files, typecheck, lint, build |

## What was actually done

Phase F (Tasks 19–23: Git, SSH, secrets) was merged before this session but had never built. The
work here was: make it build, then run it on a device, then fix what the device exposed.

### 1. The merged tree did not build (`993d4ad`)

`org.eclipse.jgit.ssh.apache:5.13.3` pulls `org.apache.sshd:sshd-osgi:2.7.0` — an uber-jar that
already bundles `sshd-core`, `sshd-common` and `sshd-sftp` — while the build also pinned
`sshd-core:2.13.2`. Every SSHD class existed twice, so `mergeDebugJavaResource` failed on duplicate
classes and on `org/apache/sshd/common/kex/group17.prime`. **No test had ever run on that tree.**

Fix: exclude `sshd-osgi`, depend on modular `sshd-core` + `sshd-sftp` at 2.13.2, and exclude the
duplicate OSGi `plugin.properties` the same way the Bouncy Castle metadata already was.

### 2. Four defects that only a device could expose

None of these were reachable from JVM tests, because the unit suites substitute a fake cipher, a
full Bouncy Castle, a JVM `user.home` and a same-thread event sink.

| # | Symptom | Root cause | Commit |
|---|---|---|---|
| 1 | Keygen: `Selected fingerprint digest not supported: sha256` | Android 12+ ships a stub `BC` provider without SHA-256; MINA resolves digests by provider *name* | `69de290` |
| 2 | Every secret write threw `SecretUnavailableException` | Keystore2 rejects a caller IV under `setRandomizedEncryptionRequired(true)` (`CALLER_NONCE_PROHIBITED`) | `69de290` |
| 3 | SSH died in `ExceptionInInitializerError: No user home` | MINA's `PathUtils` reads `System.getProperty("user.home")`; Android never sets it | `fb675a4` |
| 4 | Host-key prompt never reached the user; clone hung 120 s | Prompt emitted through a `ThreadLocal` that is empty on MINA's I/O thread | `2c4a2ac` |
| 5 | `known_hosts` wrote `[[ip]:2222]:2222` — invalid, never matched | JGit passes the connect address as `[host]:port` | `560a4aa` |

## Device verification: what is proven, and what is not

**D2 (POCO F1, LineageOS, Android 15 / API 35) — PASS.** T10 HTTPS clone, T11 Ed25519+RSA keygen,
T12 SSH clone with host-key prompt, T12B pinned-host reuse (zero prompts), T13 SSH push, T13P SSH
pull (fast-forward), T14 Keystore round-trip, T11B passphrase-protected import, T21 local Git
operations including a resolved conflict, changed-host-key rejection, and `ssh-key-logcat.sh`
clean (exit 0).

Raw evidence:
- [`device-reports/20261115-211717-phaseF-D2-e76846f.txt`](device-reports/20261115-211717-phaseF-D2-e76846f.txt)
- [`device-reports/20261115-222841-phaseF-D2-e76846f-round2.txt`](device-reports/20261115-222841-phaseF-D2-e76846f-round2.txt)

**D1 (Redmi Note 7S, Android 9 / API 28) — NEVER RAN.** This is the important gap. D1 is the
compatibility gate for D-016, and it is the only API 28 hardware. Until T10–T14 run there, "JGit
5.13.3 works on our oldest supported device" is an assumption, not a measurement. Every D1 cell in
`test-matrix.md` is marked pending and must stay that way until someone actually runs it.

**Not a device row, by decision:** the HTTPS-token push. It needs a token-authenticated remote,
and its actual claim — that a token is stored but never returned — is a property of the replies,
not the transport. `PhaseFHandlerTest.remote token is stored but only flagged in replies` asserts
it through the real router instead. That test was validated by injecting a leak into the `url`
field and confirming it failed.

## Reproducing a device run

Prerequisites: a debug APK from `v9-impl`, a scratch workspace, the device **unlocked and awake**,
and its **VPN off** (see traps). Never run destructive steps against a real project.

The Phase F rows are driven by a debug-only harness because the WebView is a canvas with a single
accessibility node and debug builds expose no DevTools socket — the tests therefore call the same
`GitEngine` / `SshKeyStore` / `HostKeyPrompts` / `KnownHostsStore` / `FileSecretStore` instances
the bridge uses (`AppGraph` builds them once). Only the WebView rendering layer is skipped.

```bash
adb shell am start -n dev.leocode/.HarnessActivity --es run T12 \
    --es sshHost <host-lan-ip> --es sshPort 2222
adb logcat -d -s LeoCodeHarness:I
```

Row ids: `T10` HTTPS clone, `T10L` clone over loopback, `T11` keygen, `T11B` passphrase import,
`T12` SSH clone + prompt, `T12B` pinned-host reuse, `T13` SSH push, `T13P` SSH pull, `T13T` HTTPS
token push, `T14` Keystore, `T21` local Git + conflict. Diagnostics if something fails: `DX`
(crypto), `DN` (network reachability), `D10`/`D12`/`D13T` (raw JGit, unmapped errors).

For the SSH rows, start the committed test server:

```bash
python3 -m venv /tmp/pf-venv && /tmp/pf-venv/bin/pip install paramiko
/tmp/pf-venv/bin/python scripts/test-ssh-git-server.py   # setup steps in its header
```

`T11` mints a **fresh key every run**, so after it runs, append the `publicKey=` line from logcat
to the server's `authorized_keys` before running `T12`/`T13*`. Cross-check with `ssh-keygen -lf`.

## Traps that cost time this session (read before debugging a "network" failure)

1. **The phone's VPN blocks all app-UID sockets.** With `free.vpnindia…turbo` active, DNS
   (`UnknownHostException` for every name), loopback through `adb reverse`, and LAN all fail for
   app UIDs, while the `adb shell` UID is exempt. This looks exactly like a LeoCode networking bug.
   Turn the VPN off for any network row.
2. **A sleeping screen suspends app-UID networking.** Same symptom, same false trail. Keep the
   device awake (`svc power stayon true`). This produced two false "Cannot reach the remote"
   failures before it was identified.
3. **The host and phone changed IPs mid-session** (`192.168.58.x` → `192.168.29.x`). Re-runs then
   failed silently because the harness still pointed at the old address. Re-read `hostname -I`
   before re-running.
4. **Recreating the test server directory wipes `authorized_keys`**, so the device key must be
   re-appended. A host-key rotation is also detected correctly as `E_HOSTKEY_CHANGED` — that is the
   feature working, not a bug: forget the host (`rm files/ssh/known_hosts` or `ssh.hostkey.delete`).
5. **Do not trust an error message from `GitEngine` alone.** `BridgeException` messages are
   deliberately generic ("The Git operation failed"). Use the `D10`/`D12`/`D13T` diagnostics, which
   run raw JGit and print the real exception chain.

## Security issue to fix

**A GitHub personal access token is embedded in plaintext in `.git/config`** as the `origin` URL
userinfo (`https://souravrouth5:github_pat_…@github.com/…`). Anyone with read access to this
working copy can extract it, and it will be captured by any tooling that prints remotes. Recommend
rotating that token and re-adding the remote without userinfo (a credential helper or
`gh auth` instead). It was not changed during this session because rewriting the remote is a
decision for the owner.

## Suggested next steps

For the full list of what remains before a release, with each gate's measured status, see
[`RELEASE-READINESS.md`](RELEASE-READINESS.md).

1. **Run T10–T14 on D1.** This is the only thing blocking Tasks 21–23 from closing and D-016 from
   being settled. If 5.13.3 fails there, reopen D-016 and record the failing API and stack *before*
   changing versions.
2. Close **Tasks 19 and 20** in `PROGRESS.md` if agreeable — nothing about them depends on D1
   (D-016's decision is recorded, and the SecretStore round-trip is proven on D2).
3. Clean up the merged worktrees (`phase-f-core`, `phase-f-web`, `phase-f-docs`).
4. Then Phase G (Python, D-017) — per the tracker, Python is the primary language and was moved
   ahead of Phases D–F, so it is the next substantial body of work.

## Honest caveats

- Every D2 PASS is a **single-run measurement on one device**. Nothing here is a soak test.
- The SSH clone/push/pull rows ran against a **local test server**, not a public host. That
  exercises the same JGit transport path, but not GitHub's real server behaviour or TLS.
- `pull` was verified on a fast-forward. A conflicting pull returning `E_CONFLICT` was not
  exercised on a device (conflict detection itself was, via `T21`).
- HTTP (not HTTPS) was used for the token server attempt, so TLS for token auth is unproven on a
  device.
