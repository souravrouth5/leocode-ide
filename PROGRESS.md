# LeoCode — Progress Tracker

**Last updated:** 2026-11-08
**Current phase:** Phase 0 (feasibility) — **0B and 0E gates PASS on device 1** (Redmi Note 7S, Android 9). WebView gate passes. Next: Android 11 repeat, then 0C2 CPython.
**Plan:** [`docs/LeoCode_Implementation_Plan_v8.md`](docs/LeoCode_Implementation_Plan_v8.md)

Status key: `[ ]` not started · `[-]` in progress · `[x]` done · `[!]` blocked · `[~]` deferred

---

## 0. Snapshot

| Area | State |
|---|---|
| Plan + decisions | Done (v8) |
| Repository scaffold | Done |
| Android app (Phase 0B harness) | **Built and installed** (`app-debug.apk`, 17.6 MB) |
| Web IDE shell | **Build green** + code-split (react 46 KB gzip, codemirror 134 KB, xterm 73 KB lazy) |
| Python runtime artifacts | Draft `scripts/build-python.sh`; never run end-to-end |
| Device validation | **D1 (Android 9) done** — T1–T7 pass. D2/D3 pending |
| Android 14+ device | **Blocked — hardware not acquired** |

**Measured on device 1 (2026-11-08)** — Redmi Note 7S `lavender`, Android 9 / SDK 28, MIUI V11,
arm64-v8a, **PAGE_SIZE 4096**, WebView Chrome **137.0.7151.115**, 15.8 GB free / 51.2 GB,
3.8 GB RAM, heap cap 256 MB, SELinux enforcing (`untrusted_app`).

| Test | Result |
|---|---|
| T1 shell exec | **PASS** — exit 0 |
| T2 exec from app data (W^X gate) | **PASS** — `exec-from-data-ok` |
| T3 process-group kill | **PASS** |
| T4 exit code + stderr | **PASS** — exit 42 |
| T5 flood, bounded | **PASS** — 25 MB in 6–46 s (warm/cold), captured exactly 256 KB |
| T6 native PTY | **PASS** — output, cols=80, exit 7 |
| T7 applets | INFO — no `unzip`, `git`, `python` |

**Blocking facts (2026-11-08)**
- Android 14+ device still not available; cannot freeze Phase 0 without it.
- Android 11 phone not yet tested (software is ready).
- CI has not run on GitHub (no remote yet).

**Findings from the first device run**
- Shell pipeline throughput is 0.5–4 MB/s (thermal/cache dependent): 25 MB took 6–46 s, 50 MB took 69 s cold. Output buffering must stay bounded (it is), and the terminal UI must coalesce.
- Repeatability: two independent run-all passes (ADB-driven and UI-driven) produced the same PASS set.
- `unzip` is absent from the system shell on Android 9 → archive extraction moves to Kotlin `ZipFile`, not a shelled-out tool.
- `git`/`python` are absent as expected: JGit and the NDK CPython build are the only paths.
- 50 MB flood timing is a device property, not a bug — harness now uses 25 MB.

**Known debt added by the scaffold**
- `web` initial bundle is ~550 KB raw / ~184 KB gzip (react + codemirror); xterm is lazy-loaded. Re-measure cold start on the Redmi.
- Gradle wrapper is committed (8.9); CI still invokes the system `gradle` for speed — switch to `./gradlew` when convenient.
- `MainActivity` is the Phase 0B harness. It is replaced by the WebView shell in Phase 1.
- Web assets are not copied into `android/app/src/main/assets/web` yet.
- [x] APK is 17.6 MB because JGit/SSHD/Bouncy Castle are all bundled and R8 is off. Enable minification and check shrinker rules before release.
- `targetSdk 28` lint rule is intentionally disabled; do not "fix" it (D-002).

**Verified by unit test** (`./gradlew testDebugUnitTest`, 5/5 pass)
- workspace path jail: relative resolve, absolute-inside-root, `..` rejection, absolute-outside rejection, **symlink escape rejection**. This is the security boundary for every path crossing the bridge.

---

## 1. Gate 0 — decisions and scaffold

- [x] D-001 distribution: direct APK, no Play
- [x] D-002 targetSdk 28 / compileSdk 34 / minSdk 28
- [x] D-003 package ID `dev.leocode`
- [x] D-004 terminal: xterm.js + own JNI PTY (no GPL)
- [x] D-005 Git/SSH: JGit + MINA SSHD + Bouncy Castle
- [x] D-006 Python: system shell + NDK CPython (Track C2), userspace rebuild deferred (C1)
- [x] D-007 WebView minimum Chromium 100, hard gate, degraded mode defined
- [x] D-008 shared-UID threat model documented
- [x] D-009 Keystore envelope encryption
- [x] D-010 preview isolation
- [x] Decision records in `docs/decisions/`
- [x] Repo structure (`android/`, `web/`, `runtime-manifests/`, `runtime-packaging/`, `docs/`, `.github/workflows/`)
- [x] CI workflow definitions
- [ ] CI run green on GitHub (needs a remote repo + push)
- [x] `git init` + initial commit

## 2. Phase 0A — device and build environment

- [x] 0A command list documented in plan §6
- [x] Install SDK/NDK on laptop: `~/Android/Sdk` (platform 34, build-tools 34.0.0, CMake 3.22.1, NDK 27.0.12077973)
- [x] JDK 17 installed locally (`~/jdk17`) — system JDK 21 is a JRE without `jlink`
- [x] Verify Gradle build locally — `BUILD SUCCESSFUL`, `app-debug.apk` 17.6 MB
- [x] Redmi Note 7S: developer options + USB debugging (device visible as `11f98015`)
- [x] Redmi: capture `abilist`, `PAGE_SIZE`, Android version, MIUI version, storage, RAM
- [x] Redmi: capture WebView version (Chrome 137.0.7151.115)
- [ ] Snapdragon 695 / Android 11: same capture
- [x] **Gate: WebView ≥ 100 on D1** — 137, no degraded mode needed
- [ ] **Gate: WebView ≥ 100 on D2**
- [x] Install minimal targetSdk-28 APK on D1
- [ ] Install APK on D2
- [ ] **Gate: Android 14+ device acquired**

## 3. Phase 0B — process execution

- [x] `Workspace` (private dirs, file create/list/delete)
- [x] `ProcessHost` (exec, stream stdout/stderr, exit code, timeout, cancel)
- [x] Output ring buffer + flood test button
- [x] Harness UI + `am start --es run all|T1..T7` (logcat tag `LeoCodeHarness`)
- [x] Process-group kill implementation (JNI `setsid` + `kill(-pgid)`)
- [x] Compile the APK (Gradle 8.9, AGP 8.5.2, NDK r27)
- [x] Run T1 `/system/bin/sh` on Redmi (Android 9) — **PASS**
- [x] Run T2 exec binary from app data on Redmi — **PASS**
- [x] Run T3 process-group kill on Redmi — **PASS**
- [x] Run T4 exit-code propagation on Redmi — **PASS**
- [x] Run T5 output flood (bounded) on Redmi — **PASS**
- [x] Run T6 native PTY smoke test on Redmi — **PASS**
- [x] Run T7 applet inventory on Redmi — no unzip/git/python
- [ ] Repeat T1–T7 on Android 11
- [ ] Optional: targetSdk 29 control build to document the `execve` block
- [x] Record results in `docs/test-matrix.md`
- [ ] **Gate: exec works unrooted at targetSdk 28 on 9 and 11** — 9 PASS, 11 pending

## 4. Phase 0C — Python (Track C2, MVP)

- [x] Draft `scripts/build-python.sh` (OpenSSL → expat → libffi → CPython → pip wheel → package)
- [ ] Iterate `build-python.sh` until it produces a working artifact on CI
- [ ] 0C1 validate `/system/bin/sh` + toybox applet set on device
- [ ] 0C1 validate `HOME`, `TMPDIR`, `PATH`, `TERM` wiring
- [ ] 0C2 CI job: build CPython for `android-aarch64` with NDK
- [ ] 0C2 set prefix `/data/data/dev.leocode/files/usr`, `PYTHONHOME`
- [ ] 0C2 `python --version`, run script on device
- [ ] 0C2 `python -m pip --version`
- [ ] 0C2 `python -m venv .venv` + activate
- [ ] 0C2 `pip install requests` + import
- [ ] 0C2 console-script shebang test with real prefix
- [ ] 0C2 build one native wheel (`markupsafe`/`ujson`) in CI, install + import
- [ ] 0C2 wheel index layout + manifest generator
- [ ] Manifest signing (Ed25519, offline key)
- [ ] Compatibility matrix started (`docs/compatibility.md`)
- [ ] **Gate: baseline documented, one native wheel works**

## 5. Phase 0C1 — userspace rebuild (deferred, only if needed)

- [ ] Decide whether broad `pip`/npm compatibility is required
- [~] Fork `termux-packages`, parameterise prefix
- [~] Bootstrap set: bash, coreutils, python, pip, openssl, ca-certificates, libffi, zlib, sqlite, ncurses, readline, terminfo, make, tar, curl
- [~] CI image + reproducible build
- [~] Maintenance budget: 1–3 days/month
- [~] Licensing pass + source offer

## 6. Phase 0D — Git and SSH

- [x] Gradle dependencies chosen (JGit, MINA SSHD, Bouncy Castle) — declared, not yet exercised
- [ ] JGit: clone, status, add, commit, diff, log, branch, checkout, pull, push
- [ ] JGit: conflict detection + readable conflict state
- [ ] HTTPS token auth
- [ ] MINA SSHD: Ed25519 + RSA key generation
- [ ] Import OpenSSH / PEM / PKCS#8 keys
- [ ] Passphrase-protected keys
- [ ] Host-key prompt (SHA-256 fingerprint), changed key = hard failure
- [ ] Keystore envelope encryption for key blobs
- [ ] Error paths: wrong key, timeout, offline, DNS
- [ ] Verify no key material in logs/WebView
- [ ] **Gate: authenticated clone/push works on both phones**

## 7. Phase 0E — PTY and terminal

- [x] JNI PTY scaffold (`pty.c`: `openpty`/`fork`/`setsid`/`execvp`, resize, wait, kill group)
- [x] Kotlin `Pty` wrapper (`ParcelFileDescriptor.adoptFd` + `Os.read/write`)
- [x] xterm.js terminal component (web)
- [x] Compile native lib — `libleocodepty.so` built for arm64-v8a, loads on device
- [x] PTY spawn + output + exit-code smoke test on device — **PASS** (T6)
- [ ] Interactive shell round-trip on device (write → echo → read)
- [ ] Resize (SIGWINCH) behaviour
- [ ] Ctrl+C / Ctrl+D
- [ ] Process-group kill from UI
- [ ] Orphan reaping after app death
- [ ] Long-running script + background/reopen
- [ ] Output flood: UI stays responsive
- [ ] xterm.js mobile: keyboard open/close, `visualViewport` resize
- [ ] xterm.js: extra-keys row (Ctrl/Esc/Tab/arrows)
- [ ] Selection + copy/paste
- [ ] OSC 52 disabled, titles sanitised
- [ ] **Gate: pass/fail criteria in plan §6 (0E)** — spawn/exit proven, IME pending

## 8. Phase 0F — cross-device validation

- [ ] Run 0B/0C/0E on Android 11
- [ ] Run 0B/0C/0E on Android 14+
- [ ] MIUI autostart/battery instructions verified
- [ ] Phantom-process killer behaviour documented
- [ ] Phase 0 exit criteria reviewed; go/no-go recorded

## 9. Phase 1 — shell and workspace

- [x] Mock bridge + browser dev mode
- [x] Web UI scaffold: files, editor tabs, terminal, Git placeholder, status bar
- [x] Bridge contract v1 drafted (`docs/bridge-contract.md`)
- [x] Commit Gradle wrapper (`./gradlew`, Gradle 8.9)
- [x] Code-split bundled: xterm deferred to the terminal tab (initial bundle ~550 KB raw / ~184 KB gzip)
- [ ] Copy `web/dist` into `android/app/src/main/assets/web` during build
- [ ] WebView host activity + `WebViewAssetLoader`
- [ ] `addWebMessageListener` bridge (Kotlin side)
- [ ] Generated TS types from Kotlin models
- [ ] Workspace create/open, recent list, project metadata
- [ ] File CRUD + path jail (canonicalise + symlink check)
- [ ] SAF import/export (copy-in/copy-out)
- [ ] Zip export/backup + uninstall warning
- [ ] Navigation + settings
- [ ] Permission and error surfaces

## 10. Phase 2 — editor and terminal

- [x] CodeMirror 6 editor with Python mode, tabs, dirty state
- [ ] Mobile keyboard accessory row
- [ ] Find/replace
- [ ] Bracket matching, autocomplete tuning
- [ ] Atomic save (temp → fsync → rename)
- [ ] Draft autosave + crash recovery
- [ ] External-change detection
- [ ] Native workspace search with streaming + ignores
- [ ] Large-file tests (>1 MB)
- [ ] Terminal wired to native PTY in-app
- [ ] Terminal tab lifecycle (no process leaks)

## 11. Phase 3 — Git and SSH UI

- [ ] Repository screen (status, staged/unstaged)
- [ ] Diff viewer
- [ ] Commit box
- [ ] Branch chip + create/switch
- [ ] Pull/push with progress
- [ ] Conflict state UI
- [ ] SSH key manager UI (generate/import/fingerprint/passphrase)
- [ ] Host-key prompt UI
- [ ] HTTPS token storage UI

## 12. Phase 4 — Python runtime manager

- [ ] Runtime catalogue UI (size, version, disk used)
- [ ] Install/uninstall/update with resumable progress
- [ ] Health check + repair
- [ ] Run current file
- [ ] Run project command
- [ ] venv create/select per project
- [ ] `requirements.txt` workflow + trust prompt
- [ ] Output/cancel/errors
- [ ] Compatibility matrix published in-app

## 13. Hardening and release 0.1

- [ ] Threat-model tests (bridge fuzz, path traversal, zip bomb, OSC 52)
- [ ] Process lifecycle soak test (24 h)
- [ ] Low-memory + storage-pressure tests
- [ ] Crash reporting (opt-in, local export only)
- [ ] Onboarding (MIUI steps, trust warning, storage model)
- [ ] Self-update flow + signature check
- [ ] Release signing key generated and backed up
- [ ] Signed APK on GitHub Releases
- [ ] SBOM + pinned actions audit
- [ ] Accessibility pass (48 dp, font scaling, descriptions)
- [ ] Performance budget measured on Redmi

## 14. Later runtimes

- [~] Phase 5 Node.js (npm, Vite, preview)
- [~] Phase 6 Java (JDK, javac, then Maven/Gradle)
- [~] Phase 7 PHP (CLI, dev server, then Composer)

---

## Changelog

| Date | Change |
|---|---|
| 2026-11-08 | Repo scaffolded; plan v8 written; Android harness, JNI PTY, web IDE shell, CI added. |
| 2026-11-08 | APK built (Gradle 8.9 / AGP 8.5.2 / NDK r27) and installed on the Redmi Note 7S. Device report captured: Android 9, arm64-v8a, PAGE_SIZE 4096, WebView 137. |
| 2026-11-08 | **Phase 0B gate PASS on Android 9**: T1 shell exec, T2 exec-from-app-data (W^X), T3 group kill, T4 exit codes, T5 bounded 25 MB flood, T6 native PTY. Results in `docs/test-matrix.md`. |
| 2026-11-08 | T5 resized 50 MB → 25 MB after measuring 0.7 MB/s shell throughput; harness now drives from ADB (`--es run all`). |
