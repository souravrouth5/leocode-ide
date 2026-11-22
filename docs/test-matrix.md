# LeoCode — Device Test Matrix

Fill one cell per measurement. Do not infer a result from another device; each cell is measured.
Device policy: [plan v9 §Devices](LeoCode_Implementation_Plan_v9.md#devices) and D-014.

## Devices

| # | Model | Android | Root | SELinux | ABI | Userspace | PAGE_SIZE | WebView | ROM / skin | Storage free | RAM |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **D1** | Redmi Note 7S (`lavender`) | 9 (SDK 28, patch 2020-02-05) | No | enforcing, `untrusted_app` | arm64-v8a (+v7a,abi) | toybox, no unzip/git/python | **4096** | Chrome **137.0.7151.115** | MIUI V11 (code 9) | 15 786 MB / 51 205 MB | 3.8 GB (heap 256 MB, `docs/device-reports/20261111-harness-D1-192.168.29.26_5555.txt:13`) |
| **D2** | POCO F1 (`beryllium`) | 15 (SDK 35, patch 2025-09-01) | **No `su`** (LineageOS user build; Magisk/KernelSU not installed) | enforcing, `untrusted_app_27` | arm64-v8a (+v7a) | toybox incl. unzip/curl; no git/python/su | **4096** | WebView **156.0.8078.47** | LineageOS, build `BP1A.250505.005`, `lineage_beryllium-user` | 101 021 MB free / 115 797 MB | 5.7 GB (heap 256 MB, `docs/device-reports/20261111-harness-D2-e76846f.txt:11`) |
| X1 | SD695 phone (optional, unavailable) | 11 | No | | | | | | | | |
| X2 | Stock Android 14+ (optional, unavailable) | 14+ | No | | | | | | | | |

Raw reports: D1 [`device-reports/20261108-131918-device.txt`](device-reports/20261108-131918-device.txt); D2 [`device-reports/20261111-141335-device.txt`](device-reports/20261111-141335-device.txt). Smoke logs: `docs/device-reports/*-smoke-*.txt`.

**D2 root status (2026-11-11).** `su` is absent and `ro.debuggable=0`, so D2 is **unrooted** as
measured. D-014/Phase E expect root on D2: install a root manager (Magisk or KernelSU) and record
it here before Task 17. Until then root-mode rows stay blocked, and unrooted Android 15 is exactly
the state Task 3 needs.

**D2 page size.** 4096 B, so 16 KB hardware behaviour is not measurable here. The local and CI APK
check (`scripts/check-elf-alignment.sh`, CI run 44884113986) covers static alignment.

**Connection:** D2 on USB, D1 on Wi-Fi ADB (plan v9 §12). Record the serial used in each run's notes.
**Unrooted Android 15:** measured on D2 with `su` denied to LeoCode; mark such cells `PASS (su denied)`.
**Android 10–14:** not verified on hardware.

## Phase 0B — process execution

D1 measured 2026-11-08, `app-debug.apk` targetSdk 28, driven by
`adb shell am start -n dev.leocode/.HarnessActivity --es run all`.
The harness lives in the debug source set only; release builds do not contain it (Task 4).

| Test | D1 (A9) | D2 (A15, unrooted) | Notes |
|---|---|---|---|
| Install targetSdk-28 APK | **PASS** | **PASS** | D2: Android 15 floor is targetSdk 24 |
| Old-target warning dialog at launch | not recorded | **No dialog** (observed manually; no screenshot) | D2 app opened straight to the IDE on the `20261111` run |
| T1 `/system/bin/sh -c echo` | **PASS** — 271 ms | **PASS** — exit 0, 104 ms | D1 271 ms (`docs/device-reports/20261111-harness-D1-192.168.29.26_5555.txt:21`); D2 104 ms (`docs/device-reports/20261111-harness-D2-e76846f.txt:17`), T2 105 ms (`:24`). D2 uid `u0_a554`, SELinux `untrusted_app_27`. Timings vary per run |
| T2 exec binary from app data | **PASS** | **PASS** — `exec-from-data-ok` | D2: targetSdk 28 still allows `execve()` from app data on Android 15 |
| T2c control: targetSdk 29 build must fail T2 | not run | **BLOCKED (expected)** | D2 `error=13, Permission denied` — see `docs/device-reports/20261111-T2c-e76846f.txt`; documents the W^X gate. Rebuilt at 28 afterwards |
| T3 process-group kill (`setsid` + `kill(-pgid)`) | **PASS** | **PASS** — exited in <5 s | |
| T4 exit-code propagation | **PASS** | **PASS** — exit 42, stderr captured | |
| T5 output flood, bounded | **PASS** — 138.8 s, `180KB/s` | **PASS** — 25 MB in 312 ms, 262 144 B captured | D2 312 ms, `rate=80128KB/s` (`docs/device-reports/20261111-harness-D2-e76846f.txt:38`); D1 138 861 ms, `180KB/s` (`docs/device-reports/20261111-harness-D1-192.168.29.26_5555.txt:46`). Timings vary per run |
| T6 native PTY (`fork`/`setsid`/`TIOCSCTTY`) | **PASS** | **PASS** — `pty-ok`, `cols=80`, exit 7 | page size 4096 on both |
| T7 shell applet inventory | **INFO** | **INFO** | D2 has `unzip` and `curl`; **no** git/python/su (D1 also lacks unzip) |
| T8 PTY child env contains only allowlisted keys | **PASS** — child env exactly `HOME,LANG,LD_LIBRARY_PATH,PATH,PWD,PYTHONHOME,SSL_CERT_FILE,TERM,TMP,TMPDIR`; `unexpected=[] missing=[]` | **PASS** — same exact set, `unexpected=[] missing=[]` | Task 9: `probeEnvironment` execs `/system/bin/env` with the `ChildEnv` envp |
| T9 PTY child has no fds > 2 | **PASS** — `open_above_2=0` | **PASS** — `open_above_2=0` | Task 9: `probeFds` runs after `dup2` + `close_inherited_fds` |

> Renumbering note: v8's "T8 control build" is now **T2c**. T8–T15 are the v9 harness tests.

> **Final Phase A re-run (2026-11-11)** on the shipped targetSdk-28 APK: T1–T7 and S1 pass again on
> both phones, with the same PASS set and different timings (D2 T1 107 ms, T5 211 ms /
> `118483KB/s`; D1 T1 258 ms, T5 7.8 s / `3219KB/s`). Raw logs:
> [`device-reports/20261111-harness-final-D2-e76846f.txt`](device-reports/20261111-harness-final-D2-e76846f.txt),
> [`device-reports/20261111-harness-final-D1-192.168.29.26_5555.txt`](device-reports/20261111-harness-final-D1-192.168.29.26_5555.txt).
> The values in the table above stay tied to the earlier logs they cite; timings vary per run.

> **Post-restructure re-run (2026-11-21).** The current APK (versionCode 2, targetSdk 28) ran
> T1–T9 and S1 on both phones through the `ProcessSupervisor` path, closing the Task 6/9 device
> re-run. T1 174 ms (D1); T2 `exec-from-data-ok` with `canExecute=true`; T3 `cancelled=true
> exited=yes exit=143 groupGone=true`; T4 `exit=42` with stderr captured; T5 `truncated=true
> timedOut=false` (D1 6.0 s / `4139KB/s`, D2 307 ms / `81433KB/s`); T6 `pty-ok`, exit 7; T7
> inventory (D1 has no `unzip`, D2 does; neither has `git`/`python`); T8 the exact allowlist with no
> extras or missing keys; T9 `open_above_2=0`; S1 read/write/writeTest true. Raw logs:
> [D1](device-reports/20261121-135916-phaseB-rerun-D1-11f98015.txt),
> [D2](device-reports/20261121-135924-phaseB-rerun-D2-192_168_29_85_39941.txt).

**Throughput finding.** `yes | head -c` moves 0.5–4 MB/s through the system shell on D1
(cold 50 MB: 69 s; 25 MB: 46 s cold, 13 s, then 6 s warm). Real compiler/test output is far
smaller; the number matters only for the output-buffer and coalescing design.

**Repeatability.** Two independent runs produced the same PASS set (harness-driven and
user-driven from the UI). T5's timing is the only value that varies, as expected.

**Shell gap.** `unzip` is absent, so runtime/archive extraction must be done in Kotlin
(`ZipFile`/`ZipInputStream`, commons-compress), not by shelling out. `git` and `python` are
supplied by JGit and the CPython package respectively.

## Phase 0A — WebView gate

| Check | D1 | D2 |
|---|---|---|
| WebView version | 137.0.7151.115 (Chrome) | **156.0.8078.47** (Android System WebView) |
| Chromium ≥ 100 | **PASS** | **PASS** |
| `WebViewFeature.isFeatureSupported(ADD_WEB_MESSAGE_LISTENER)` | **PASS** — bridge answers `app.info` | **PASS** — IDE shell boots, workspace status shown |
| CodeMirror 6 boots | **PASS** — Python highlighting, line numbers, keymap | **PASS** — editor pane loads |
| xterm.js boots | **PASS** — raw PTY bytes render | not exercised (Task 6/9) |
| Degraded mode required? | **No** | **No** |

## 16 KB pages and native code (Task 2, 24)

**No tested device runs 16 KB pages.** Both D1 and D2 use 4096-byte pages
(`docs/device-reports/20261111-harness-D2-e76846f.txt:9,41`;
`docs/device-reports/20261111-harness-D1-192.168.29.26_5555.txt:11,50`), so the
D1/D2 cells below are static-check-only placeholders, not runtime evidence.

| Check | CI | D1 | D2 |
|---|---|---|---|
| `libleocodepty.so` all `LOAD` align ≥ `2**14` | **PASS** (`scripts/check-elf-alignment.sh`: `0x4000`; CI run 44884113986) | n/a (device uses 4 KB pages; static check only) | n/a (device uses 4 KB pages; static check only) |
| `zipalign -c -P 16 -v 4` on APK | **PASS** (local + CI run 44884113986) | — | — |
| Python package `.so` files aligned | **PASS** (80 ELFs from the 3.14.10 artifact; `scripts/check-runtime-artifact.py` in the `python-runtime` CI job) | n/a (static check only) | n/a (static check only) |
| PTY library loads (T6) | — | **PASS** | **PASS** |
| Device page size | — | 4096 | **4096** |

## Phase 0C — Python (Tasks 24–26)

> **Task 25 device evidence (2026-11-21).** The installer was exercised through
> the debug harness on both phones; raw logs are in
> [`device-reports/20261121-task25-D1-D2.txt`](device-reports/20261121-task25-D1-D2.txt).
> T25 installs the signed python.org 3.14.10 artifact, T25L reads the catalog,
> and T25C cancels mid-download without touching the installed tree.
>
> **Task 24 CI evidence (2026-11-21, run
> [44915640602](https://github.com/souravrouth5/leocode-ide/actions/runs/44915640602)).**
> The `python-runtime` job verifies the pinned artifact (`sha256 423c80b9…`,
> 23 027 305 bytes), the safe tar layout, the pruned size (42 190 285 ≤
> 47 185 920 bytes) and all 80 ELFs for 16 KB alignment, then checks the
> Ed25519 signature and builds the `markupsafe` wheel
> (`cp314-cp314-android_24_arm64_v8a`, `sha256 2fb50c46…`). The signed
> release/publish job is gated on the protected `python-runtime` environment.
> Details: [`reports/task24-verification.md`](reports/task24-verification.md).
>
> **Task 26 device evidence.** Raw probes on both phones through `run-as` on
> 2026-11-21. On 2026-11-22 both D1 and D2 passed T15 through the production
> harness and the full app-UI flow (panel, venv + trust, pip + trust, Run through
> the venv, trust persistence, requirements change → fresh prompt). The D2 run
> found and fixed `proc.run` resolving a relative `cwd` against the default
> workspace instead of the active one. The LAN needs an authenticated proxy, so
> the host forwarded one with `adb reverse tcp:18080`; the UI demos also used a
> local wheelhouse on `18081`. Both are test plumbing, not app behaviour. Logs:
> [`device-reports/20261121-task26-D1-D2.txt`](device-reports/20261121-task26-D1-D2.txt),
> [`device-reports/20261122-task26-D1-ui.txt`](device-reports/20261122-task26-D1-ui.txt)
> and [`device-reports/20261122-task26-D2-ui.txt`](device-reports/20261122-task26-D2-ui.txt).

| Test | D1 | D2 |
|---|---|---|
| `/system/bin/sh` available | **PASS** | **PASS** |
| toybox applets: ls/cat/grep/find/sed/tar | **PASS** (no unzip) | **PASS** (unzip present) |
| Runtime artifact sha256/size + safe tar layout | **PASS** (CI) | **PASS** (CI) |
| Runtime install (download, verify, extract, health check) | **PASS** (74 s) | **PASS** (497 s fresh, 333 s resumed) |
| Install resumes after network loss | N/A (Wi-Fi-only ADB; turning the radio off drops the test transport) | **PASS** (`E_OFFLINE` at 3 307 954 B, resumed from the same offset; second `E_OFFLINE` at 6 011 314 B, final retry completed) |
| CPython `--version` | **PASS** (`Python 3.14.10`) | **PASS** (`Python 3.14.10`) |
| run script (fetch `https://example.com`) | **PASS** (`200`, 577 bytes) | **PASS** (`200`, 577 bytes) |
| `pip --version` | **PASS** (`pip 26.2.2`) | **PASS** (`pip 26.2.2`) |
| `markupsafe` Android wheel builds | **PASS** (CI, 16 KB aligned) | **PASS** (CI, 16 KB aligned) |
| `markupsafe` wheel installs + imports | **PASS** (`_speedups` loaded) | **PASS** (`_speedups` loaded) |
| PyPI Android wheel accepted by pip | **PASS** (`charset-normalizer` 3.5.2) | **PASS** (`charset-normalizer` 3.5.2) |
| `venv` create + activate | **PASS** | **PASS** |
| venv + `pip install requests` + import `markupsafe` (probe) | **PASS** (requests 2.34.2; markupsafe from the LeoCode wheel) | **PASS** (requests 2.34.2; markupsafe from the LeoCode wheel) |
| T15 production harness (venv + requirements + wheel + fetch) | **PASS** (2026-11-22; wheel + fetch `200`, 577 bytes) | **PASS** (2026-11-22; wheel + fetch `200`, 577 bytes) |
| App UI: venv create + trust, pip + trust, Run via venv, trust persistence, requirements change re-prompts | **PASS** (2026-11-22; Run `EXIT 0`, screenshots in the D1 report) | **PASS** (2026-11-22; Run `EXIT 0`, screenshots in the D2 report) |
| console script shebang | **PASS** (`pygments` → venv python) | **PASS** (`pygments` → venv python) |
| venv symlinks on internal storage | **PASS** (`python` → `python3` → `usr/bin/python3`) | **PASS** (`python` → `python3` → `usr/bin/python3`) |
| peak RSS of `python -c pass` | **8548 KB** | **11064 KB** |

## Phase 0D — Git / SSH (Tasks 19–23)

> **D1 and D2 measured.** The Phase F worktrees merged on `v9-impl`, the Android and web gates are
> green, and a debug APK (versionCode 2, targetSdk 28) ran on D2 (2026-11-15) and D1 (2026-11-21)
> against scratch workspaces. Every Phase F row passes on both phones; the D1 run closes D-016's API 28
> half. Evidence: [`20261115-211717-phaseF-D2-e76846f.txt`](device-reports/20261115-211717-phaseF-D2-e76846f.txt),
> [`20261115-222841-phaseF-D2-e76846f-round2.txt`](device-reports/20261115-222841-phaseF-D2-e76846f-round2.txt)
> and [`20261121-131954-phaseF-D1-11f98015.txt`](device-reports/20261121-131954-phaseF-D1-11f98015.txt).
> Fill one cell per device only after that device ran the check.

| Test | D1 | D2 |
|---|---|---|
| T10 JGit HTTPS clone (public repo) | **PASS** — `https://github.com/octocat/Hello-World.git`, 4515 ms, 7 `git.progress` events, reply on finish, branch `master` head `7fd1a60`, tree `.git,README` | **PASS** — `https://github.com/octocat/Hello-World.git`, 3181 ms, 7 `git.progress` events, reply on finish, branch `master` head `7fd1a60`, tree `.git,README` |
| T11 Ed25519 keygen (MINA + BC) | **PASS** — `id=91e826f9-3d78-4056-8b52-d1be73ad0e4b`, fingerprint `SHA256:Z19SOjjoc7W8yMAIUSMTFY7ak6OtNrXclpKfCeRbysM` matching `ssh-keygen -lf`, public line `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJuxz/bdyPLIQBZj2cGxUDk22vDLKF3+Dxw7vRGNVgZc leocode-harness`; private key stored as an 82-byte ciphertext blob | **PASS** — `id=115dc0c8-3eba-4326-b98d-6447d4be7dd4`, fingerprint `SHA256:DfJYcVRxlSyI4b1liTdws+EKLTztCn1GFwac0kgOWNc` matching `ssh-keygen -lf`, public line `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF+/yexV1AMqZ0Ox2W17Z4VZG+PsDiWACpPNuGPPJ/Lr leocode-harness`; private key stored as an 82-byte ciphertext blob |
| T12 SSH clone | **PASS** — unknown host prompted once with `host=127.0.0.1`, `ssh-ed25519`, fingerprint `SHA256:EMcf7dnfZ/cYIa7iG4b6dkHIwt6esb4e8tE+DAFULH4` matching the server's `ssh-keygen -lf`; `remember: true` wrote the valid line `[127.0.0.1]:2222 ssh-ed25519 …`; clone completed (`main`, head `004e795`, 7 files) | **PASS** — unknown host prompted once with `host=192.168.58.247`, `ssh-ed25519`, fingerprint `SHA256:fZbSQBKUY6xnK9glFydpKKFoAeFkEUJhC7R2G8iYd9o` matching the server's `ssh-keygen -lf`; `remember: true` wrote the valid line `[192.168.58.247]:2222 ssh-ed25519 …`; clone completed (`main`, head `1e5c57d`, 5 files) |
| T13 push to test repo | **PASS** (SSH) — commit `c361695`, 25 `git.progress` events; verified with `git log` in the remote bare repo. HTTPS-token variant not run on a device (see the row below) | **PASS** (SSH) — commit pushed, 12 `git.progress` events; verified with `git log` in the remote bare repo. HTTPS-token variant not run on a device (see the row below) |
| T14 Keystore envelope round-trip (StrongBox: yes/no) | **PASS** — token round-trip matched; `LCS1` ciphertext blob, 58 bytes; `plaintextOnDisk=false`; a second T14 after force-stop + relaunch passed; log `LeoCodeSecrets: strongBox=false` (no StrongBox) | **PASS** — token round-trip matched; `LCS1` ciphertext blob, 57 bytes; `plaintextOnDisk=false`; survives force-stop + relaunch; log `LeoCodeSecrets: strongBox=false` (no StrongBox) |
| JGit version used (D-016) | 5.13.3.202401111512-r | 5.13.3.202401111512-r |
| status / add / commit | **PASS** — untracked → `added:a.txt` → commit `614da1f` | **PASS** — untracked → `added:a.txt` → commit `266ec63` |
| diff / log / branch | **PASS** — 8-line diff, `log` newest-first, branches `[feature, main*]` | **PASS** — 8-line diff, `log` newest-first, branches `[feature, main*]` |
| pull / push over SSH | **PASS** (both) — push see T13; pull fast-forwarded one working copy to a commit pushed by another (`004e795` → `45e8827`) and the new file arrived intact | **PASS** (both) — push see T13; pull fast-forwarded one working copy to a commit pushed by another (`30b287f` → `c93cbd1`) and the new file arrived intact |
| pull / push over HTTPS token | not run on a device (needs a token-authenticated remote). The security claim is covered in CI instead: `PhaseFHandlerTest.remote token is stored but only flagged in replies` asserts a token set through `git.remote.set` is stored, never returned by `git.remote.list`, and reported only as `hasToken` | same |
| conflict detected + resolved | **PASS** — conflict on `a.txt` with markers, `ours`/`theirs` parsed; `resolve` with `ours` cleared it; final content `one/two/main` | **PASS** — conflict on `a.txt` with markers, `ours`/`theirs` parsed; `resolve` with `ours` cleared it |
| RSA keygen | **PASS** — generated in the same run as T11, fingerprint `SHA256:KDvWVDmjpyD04jJnqBjFSBxGyafvBL/8cpb/GJ0htMY` | **PASS** — generated in the same run as T11, fingerprint `SHA256:RpJ6TZbbLRuwl4l8hrbs0hRHSEyUsx6Ge7sePeQk/7E` |
| passphrase-protected key import | **PASS** — imports a passphrase-protected PEM key, unlocks with the correct passphrase, and rejects both a wrong passphrase and no passphrase | **PASS** — imports a passphrase-protected PEM key, unlocks with the correct passphrase, and rejects both a wrong passphrase and no passphrase |
| host-key prompt + fingerprint | **PASS** — see T12; a second clone with the pin in place prompted zero times | **PASS** — see T12; a second clone with the pin in place prompted zero times |
| changed host key rejected | **PASS** — after rotating the server host key the clone failed `E_HOSTKEY_CHANGED` with no prompt (raw D12: `Server key did not validate`); restoring the key restored the clone | **PASS** — after rotating the server host key the clone failed `E_HOSTKEY_CHANGED` with no prompt; restoring the key restored the clone |
| no key material in logcat | **PASS** — `scripts/ssh-key-logcat.sh 11f98015` exited 0, "clean: no private-key markers" | **PASS** — `scripts/ssh-key-logcat.sh` exited 0, "clean: no private-key markers" |

The JVM and web gates behind these rows are recorded in
[`reports/phase-f-verification.md`](reports/phase-f-verification.md): 357 Android unit tests, 277 web
tests in 40 files, `lintDebug`, `assembleDebug` and the web build all pass.

**How to run.** Use a debug APK from the merged tree and a scratch workspace; never run destructive
steps against a real project. Run each row separately on D1 and D2 and record the serial in the run
notes.

1. **T10 — HTTPS clone.** Git tab → Clone → `https://github.com/octocat/Hello-World.git` into an
   empty workspace. Expect `git.progress` then a `GitStatusReply`; the clone must finish before the
   reply (the UI shows progress until then), and `git.cancel` with the same `opId` must work.
2. **T11 — Ed25519 keygen.** SSH keys → Generate → Ed25519. Expect one `ssh-ed25519` public line;
   compare its fingerprint with `ssh-keygen -lf` on a laptop and with `ssh.hostkey.list`. RSA
   keygen is the separate row below.
3. **T12 — SSH clone.** Add the generated public key to a test account, then clone
   `git@github.com:<account>/<test-repo>.git`. First connection must show `ssh.hostkey.prompt` with
   a SHA-256 fingerprint before auth; the clone must block until the answer. `remember: true` must
   add one `known_hosts` line.
4. **T13 — push.** Commit in the clone, then push a throwaway branch to the test repo
   (`git.push`). Verify the branch on the remote and with a fresh clone. Repeat over HTTPS with a
   token (`secrets.token.set`) and confirm the token never appears in a reply or log.
5. **T14 — Keystore round-trip.** Store a token, force-stop and relaunch, and confirm the token
   still authenticates while `files/secrets/` contains ciphertext only. Capture the host log line
   `LeoCodeSecrets: strongBox=<boolean>` and put `yes` or `no` in the cell. If Keystore invalidation
   can be induced safely on a throwaway build, confirm it maps to `E_UNSUPPORTED` with the
   "re-enter them" message; do not remove a device lock on a phone holding real data.
6. **No key material in logcat.** After T10–T14, run `scripts/ssh-key-logcat.sh [serial]`
   (exit 0 = clean, 1 = a private-key marker was found, 2 = adb/logcat error). Investigate any hit
   before recording PASS.
7. **D-016 compatibility.** Test the build pinned to JGit 5.13.3.202401111512-r. D1 is the API 28 /
   no-desugaring gate; it passed T10–T14 on 2026-11-21, so the pinned version is settled. D2 covers
   Android 15. Do not copy a result from one device to the other; a future major bump needs a fresh D1
   run.

**Environment prerequisites.** Two device properties decide whether these rows mean anything:

- **A third-party VPN on the phone blocks every app-UID socket.** With one (`free.vpnindia…turbo`)
  active, DNS failed (`UnknownHostException` for every name), as did loopback through `adb reverse`
  and LAN, while the `adb shell` UID was exempt. T10 and T13 require it to be off.
- **Reaching the test server from D1.** When the host and phone are on different subnets (the
  2026-11-21 run had the host on `192.168.34.247` and D1 on `192.168.29.26`), use
  `adb reverse tcp:2222 tcp:2222` and pass `--es sshHost 127.0.0.1 --es sshPort 2222`. With no VPN
  active the app UID can use that reverse-loopback socket. D2 used the host's LAN address.
- **MINA needs `user.home` on Android.** MINA's `PathUtils` reads `System.getProperty("user.home")`,
  which Android never sets, so every SSH transport failed with `ExceptionInInitializerError`. `LeoApp`
  now sets it to the app's `filesDir/home` (the same `$HOME` the shells get) before MINA initialises.

Raw logs go in `docs/device-reports/` and are cited in the tracker/report next to each cell;
screenshots are optional but useful for the host-key prompt.

## Phase 0E — PTY / terminal

| Test | D1 | D2 |
|---|---|---|
| PTY spawn + output + exit code | **PASS** | **PASS** (T6) |
| interactive shell round-trip | **PASS** (Phase 1 smoke: prompt, `ls`) | not exercised (Task 6/9) |
| resize (SIGWINCH) | **PASS** (live resize) | not exercised |
| Ctrl+C | | |
| Ctrl+D | | |
| process-group kill from UI | **PASS** (run sheet Stop, no children left) | |
| orphan reaped after app death | | |
| output flood with xterm.js attached, UI responsive | | |
| keyboard open/close layout | | |
| extra-keys row inserts control chars | | |
| selection + copy/paste | | |
| OSC 52 write ignored | | |
| terminal title sanitised | | |
| ANR count during session | | |

## Root mode (Tasks 17–18, D2 only)

> **Blocked on D2 (2026-11-11):** `su` is absent (`ro.debuggable=0`, LineageOS user build).
> Every D2 cell in this table is therefore **blocked until a root manager is installed and
> recorded** in the devices table. D1 correctly reports "no su" and never prompts.

| Test | D1 | D2 |
|---|---|---|
| No `su` prompt at startup | **N/A** (no `su`) | blocked: D2 not rooted |
| Toggle shows "Root not available" | | blocked: D2 not rooted |
| Enable → warning sheet → grant | N/A | blocked: D2 not rooted |
| Grant denied → `E_ROOT_DENIED` sheet | N/A | blocked: D2 not rooted |
| Grant revoked in root manager mid-session → session ends + banner | N/A | blocked: D2 not rooted |
| Root session `id` shows `uid=0` | N/A | blocked: D2 not rooted |
| Run as root: output + exit code | N/A | blocked: D2 not rooted |
| Stop root job leaves no process (`su -c ps`) | N/A | blocked: D2 not rooted |
| ROOT badge visible while root process alive | N/A | blocked: D2 not rooted |
| `su` denied: all non-root features unchanged | N/A | blocked: D2 not rooted |

## Background survival and lifecycle (Task 10)

> JVM tests: `RingBufferTest` (drop-oldest + tail of oversized write), `TerminalRegistryTest`
> (scrollback snapshot, live attach, detach/reattach, exited session), `OrphanReaperTest`
> (SIGTERM → SIGKILL, recycled pid ignored) and the pidfile case in `ProcessSupervisorTest`
> pass. Device runs on 2026-11-14 used an APK built from the synced web bundle.

| Test | D1 | D2 |
|---|---|---|
| Foreground notification "N processes running" + Stop all | **PASS** — `isForeground=true`, notification `1 process running` with the Stop-all action (`docs/device-reports/20261114-160039-devicectl-*`); Stop all now reports `exited 143` + Restart and leaves no child (`20261121-task6-yes-stop-D1-D2.txt`) | **PASS** — same dump (`docs/device-reports/20261114-160036-devicectl-*`); same 2026-11-21 Stop-all result |
| Notification permission prompt (A13+, targetSdk ≤ 32 behaviour) | N/A | **PASS** — dialog shown on the first job, then remembered; app importance not measured |
| `sleep 600; echo done` survives 10 min in background | **PASS** — the shell (pid 7638) stayed alive through rotation and a forced Activity recreation; adb `input text` duplicates characters on this WebView, so the typed line is garbled (see report) | **PASS** — typed at 15:22, backgrounded >10 min, returned at 15:34: `done` plus a fresh prompt, no new banner |
| Terminal reattaches with scrollback (`term.attach`) | **PASS** — same pid before/after recreation, scrollback replayed (`...-155805-d1-reattach-fresh-*.png`) | **PASS** — reattached from background (`...-153434-task10-done-*.png`) |
| Survives rotation / theme change | **PASS** — portrait→landscape→portrait, then `wm density` recreation; pid unchanged | not needed (covered by the background/reattach run) |
| Phantom-process killer effect (A12+) | N/A | pending |
| Root option: `max_phantom_processes` applied | N/A | pending |
| MIUI "no restrictions" + autostart documented | **PASS** — Settings → Environment (`SettingsDialog.tsx`) | N/A |
| low-memory kill behaviour | pending | pending |
| storage pressure (< 500 MB) | pending | pending |
| thermal throttling during long job | | |

## Crash recovery and errors (Tasks 8, 11, 12)

| Test | D1 | D2 |
|---|---|---|
| Renderer killed (debug intent) → WebView recreated + banner | **PASS** — `escalate=false REBUILD_NOW`, page returned, banner “Restored after a problem” (`docs/device-reports/20261121-task8-demo-D1-D2.txt`) | **PASS** — same log line, banner in `20261121-task8-renderer-banner-D2.png` |
| Second kill inside 60 s → `RecoveryActivity` | **PASS** — `escalate=true RECOVER_NOW`, native screen, Restart returns to the editor | **PASS** — same |
| Forced host crash → RecoveryActivity → Restart | **PASS** — `--ez forceCrash true`, `files/crash/last-crash.json`, RecoveryActivity, Restart → `MainActivity` | **PASS** — same (bounds tap on Restart) |
| Share diagnostics contains no outside paths / secrets | **PASS** — chooser opens with the redacted report; `Redactor` + `security.test.ts` cover the payload | not re-measured |
| Cancelled SAF picker → snackbar | pending | pending |
| Disk full on save → error sheet | pending | pending |
| Bridge timeout → banner, no endless spinner | pending | pending |
| Back: sheets → Files → exit | **PASS** (Phase 1); 2026-11-21 order is drawer → Settings → Terminal → app | **PASS** (2026-11-21) |

## Phase 1 — IDE shell (WebView + bridge)

Measured 2026-11-08 on D1, debug APK with the real IDE (no harness).

| Test | D1 (A9) | D2 (A15) | Notes |
|---|---|---|---|
| Cold start → first frame | **2.77 s** (2026-11-08); 3.309 s (2026-11-11, after reinstall) | **0.941 s** (2026-11-11) | `am start -W` TotalTime; D2 `LaunchState: COLD`. A sleeping screen on D1 makes `-W` report tens of seconds; `smoke.sh` wakes it first |
| Splash before JS runs | **PASS** | **PASS** | static markup in `index.html`, correct theme from URL |
| Bridge attach (`addWebMessageListener`) | **PASS** | **PASS** | origin `https://appassets.androidplatform.net` only |
| List workspace | **PASS** | **PASS** (observed: IDE shell boots — visual observation, not harness evidence) | dirs first, sizes, `.trash` hidden |
| Create file | **PASS** | not exercised | prompt sheet → `fs.write` |
| Open + edit | **PASS** | not exercised | CodeMirror, Python highlight, dirty dot |
| Save | **PASS** | not exercised | `print(1+2)` on disk; tmp → fsync → rename (rename-over fix in Task 4) |
| Terminal PTY | **PASS** | not exercised | prompt, `ls` runs, live resize, restart button |
| Terminal keystroke batching | **PASS** | not exercised | one bridge message per animation frame |
| Theme: system / light / dark | **PASS** | **PASS** (observed: dark rendered — visual observation, not harness evidence) | `data-theme` + status/nav bars update together |
| No first-paint theme flash | **PASS** | **PASS** | mode + resolved theme passed in the page URL |
| Keyboard accessory rows | **PASS** | not exercised | keeps soft keyboard open |
| Adaptive launcher icon | **PASS** | not exercised | MIUI squircle mask, art visible |
| Back button hierarchy | **PASS** | not exercised | closes sheets → returns to Files → exits |
| Rename / delete | PARTIAL | | implemented, not yet exercised on device; delete uses `.trash` |
| Shared storage browsing (legacy permission) | **PASS** (S1: 56 entries, write round-trip) | **PASS** (S1: 27 entries, write round-trip) | targetSdk 28 keeps legacy storage on Android 15; `PRIVATE_FLAG_REQUEST_LEGACY_EXTERNAL_STORAGE` |
| Path jail: `/system/build.prop` → `E_PATH_OUTSIDE_ROOT` | | | Task 4 |

**Cold-start breakdown.** WebView init dominates; the web bundle is ~45 KB gzip at boot and
CodeMirror (133 KB) / xterm (74 KB) are fetched on first use.

## Workspace and editor (Tasks 14–16)

> **Automated coverage (2026-11-14).** JVM and web gates are green; see
> [`reports/task14-16-verification.md`](reports/task14-16-verification.md).
> JVM: `WorkspaceStoreTest`, `DraftsTest`, `SearchEngineTest`, `ZipBackupTest`,
> `FileHashTest`, `WorkspaceHandlerTest`, `DraftHandlerTest`,
> `SearchHandlerTest`, expanded `SafHandlerTest`. Web: `mock.phaseD.test.ts`,
> `workspaceStore.test.ts`, `searchStore.test.ts`, `editorPhaseD.test.ts`.
> The D1/D2 cells below are **device** measurements and stay pending; both
> phones were unavailable for this session.

| Test | D1 | D2 |
|---|---|---|
| Create / switch two workspaces | | |
| Import folder via SAF | | |
| Export + restore zip backup | | |
| Draft restored after force-stop | | |
| External change banner after terminal edit | | |
| > 1 MB file opens in large-file mode | | |
| Find / replace | | |
| Search ~1 000-file repo | | |

## Onboarding and diagnostics (Task 27)

| Test | D1 (A9) | D2 (A15) | Notes |
|---|---|---|---|
| Fresh install shows the 3 onboarding screens in order | **PASS** (2026-11-22) | **PASS** (2026-11-22) | storage model → battery/MIUI/phantom-process killer → trust |
| Trust warning cannot be skipped | **PASS** | **PASS** | "Start coding" disabled until the acknowledgement; no close/backdrop; back walks the steps and does not exit |
| Onboarding stays finished | **PASS** | **PASS** | `localStorage["leocode.onboarding.v1"]="1"`; force-stop + relaunch opens the IDE |
| Settings › About › Diagnostics fields | **PASS** | **PASS** | device, Android/SDK/patch, ABIs, WebView, page size, root, storage, heap, workspace, runtimes, last crash, recent errors |
| Copy diagnostics | **PASS** | **PASS** | clipboard receives exactly the visible report; "Diagnostics copied" |
| Share diagnostics | **PASS** | **PASS** | system chooser: `ChooserActivity` (A9) / `ChooserActivityLauncher` (A15) |
| Report redacts paths and tokens | **PASS** | **PASS** | injected `/data/... token=...` became `<path> token=<redacted>`; no `/data/` or `/storage/` in the report |
| Recent errors appear in the report | **PASS** | **PASS** | newest first, timestamp + correlation id |

Evidence: [`device-reports/20261122-task27-D1-D2.txt`](device-reports/20261122-task27-D1-D2.txt)
with the D1 and D2 screenshots beside it. D2's unattended first launch had the
marker already set without harness input; a `pm clear` restored the first-run
state, and an untouched second launch stayed on the onboarding, so the anomaly
is recorded rather than inferred.

## Release (Tasks 28–29)

| Test | D1 | D2 |
|---|---|---|
| R8 release build passes `smoke.sh` | | |
| Signed rc installs over previous build | | |
| In-app update check finds next rc | | |
| 4 h soak (Wi-Fi ADB) | | |
| Accessibility: 48 dp, 200 % font | | |
| Keystroke-to-glyph < 50 ms | | |
| Editor RSS < 120 MB | | |

## Legend

`PASS` / `FAIL` / `PARTIAL (note)` / `N/A` / `INFO`. Any FAIL that blocks an exit criterion is a go/no-go item.
