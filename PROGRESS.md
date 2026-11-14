# LeoCode — Progress Tracker

**Last updated:** 2026-11-11
**Current phase:** Plan v9. Phase A fix-ups A-01…A-10 are done and the local exit gate was green
(2026-11-11). Phase B has started: **Task 4 (path jail and file safety)**, **Task 5 (typed
`app.*`/`fs.*` router)** are done. **Task 6 (proc/term/saf/storage/runtime handlers)** and **Task 7
(generated TS types)** are code-complete and verified locally; their device re-run and CI run are
pending (see §1).
Tasks 2 and 3 stay `[-]` until CI has run on GitHub: the branch is now pushed, but the repo token
cannot read Actions results, so the owner must confirm the run. D2 is measured but **unrooted**
(no `su`); the owner will root it before Phase E.
**Plan:** [`docs/LeoCode_Implementation_Plan_v9.md`](docs/LeoCode_Implementation_Plan_v9.md) (v8 is history)

Status key: `[ ]` not started · `[-]` in progress · `[x]` done · `[!]` blocked · `[~]` deferred

---

## 0. Snapshot

| Area | State |
|---|---|
| Plan + decisions | **v9** (D-001…D-017; D-016 open until Task 19; **D-017 Python is the primary language**) |
| Devices | D1 Redmi Note 7S, Android 9, unrooted — measured. D2 POCO F1, Android 15, **unrooted (no `su`)** — measured 2026-11-11 (Task 3) |
| Android app (real IDE shell) | Built and installed on D1 and D2 (`app-debug.apk`, versionCode 2, targetSdk 28). The CI workflow (NDK r28, unit tests + blocking lint, 16 KB alignment check) **has never run on GitHub** — it is YAML-parse-checked only. **Not production-grade** — see §2 |
| Web IDE shell | Live on D1 — collapsible file explorer with search, 6-mode sort, properties sheet, binary & dotfile filters, shared-storage browsing, multi-tab editor with session restore, live PTY terminal, runtime manager UI |
| Branding & mascot | Puppy coder mascot (`design/app-icon.png`) on launcher, splash and app bar |
| Theme & settings | System/Light/Dark, 6 syntax themes, font picker, font size stepper |
| Code formatting | In-browser Prettier for JS, TS, HTML, CSS, Markdown, JSON |
| Syntax highlighting | Python, JS, TS, HTML, CSS, JSON, PHP, Rust, SQL, XML, YAML, Shell |
| Run + undo/redo | Run badge, live output sheet with Stop (process-group kill), undo/redo keys |
| CI / CD | Builds on push; publishes a **debug** APK as `nightly` (to become a signed prerelease, Task 28) |
| Python runtime | **Prototype only** (commit `1a279a2`): installer, launcher, bundled manifest; builds and passes tests. Manual install runs on D1 and D2 succeeded, but no raw log is committed under `docs/device-reports/`, so P-10 stays open. Does not meet D-012 (defects P-01…P-10 in the Phase A report). Python is the primary language (D-017): Tasks 24–26 and 30–33 follow Phase C |
| Git / SSH | Dependencies declared, not used (Tasks 19–23) |
| Root mode | Not started (Tasks 17–18) |

**Measured on D1 (2026-11-08)** — Redmi Note 7S `lavender`, Android 9 / SDK 28, MIUI V11,
arm64-v8a, **PAGE_SIZE 4096**, WebView Chrome **137.0.7151.115**, 15.8 GB free / 51.2 GB,
3.8 GB RAM, heap cap 256 MB, SELinux enforcing (`untrusted_app`).

| Test | Result |
|---|---|
| T1 shell exec | **PASS** — exit 0 |
| T2 exec from app data (W^X gate) | **PASS** — `exec-from-data-ok` |
| T3 process-group kill | **PASS** |
| T4 exit code + stderr | **PASS** — exit 42 |
| T5 flood, bounded | **PASS** — 25 MB in 138.8 s / `180KB/s` (cold, Wi-Fi ADB; varies per run), captured exactly 256 KB |
| T6 native PTY | **PASS** — output, cols=80, exit 7 |
| T7 applets | INFO — no `unzip`, `git`, `python` |

**Measured on D2 (2026-11-11)** — POCO F1 `beryllium`, LineageOS (`BP1A.250505.005`,
`lineage_beryllium-user`), Android 15 / SDK 35, patch 2025-09-01, arm64-v8a, **PAGE_SIZE 4096**,
WebView **156.0.8078.47**, 5.7 GB RAM (heap 256 MB), 99 GB free, SELinux enforcing,
`ro.debuggable=0`. **`su` is absent: D2 is not rooted as measured.** Serial `e76846f` (USB).
Raw report: [`docs/device-reports/20261111-141335-device.txt`](docs/device-reports/20261111-141335-device.txt).

| Test | Result |
|---|---|
| Install targetSdk-28 APK on Android 15 | **PASS** — no install-floor problem |
| Old-target warning dialog | **None** — observed manually (no screenshot captured); app opened straight to the IDE |
| T1 shell exec | **PASS** — exit 0, 104 ms (varies per run) |
| T2 exec from app data (W^X gate) | **PASS** — `exec-from-data-ok` (critical for D-002 on A15) |
| T2c control build at targetSdk 29 | **BLOCKED (expected)** — `error=13, Permission denied`; reverted to 28 |
| T3 process-group kill | **PASS** |
| T4 exit code + stderr | **PASS** — exit 42 |
| T5 flood, bounded | **PASS** — 25 MB in 312 ms / `80128KB/s` (varies per run), captured exactly 262 144 B |
| T6 native PTY | **PASS** — `pty-ok`, `cols=80`, exit 7 |
| T7 applets | INFO — has `unzip`, `curl`; no `git`, `python`, `su` |
| S1 shared storage (legacy permissions) | **PASS** — 27 entries, write/read round-trip in Downloads |
| Cold start → first frame | **0.941 s** (`am start -W`, COLD; 1.088 s on the first run) |
| Notification prompt (A13+, targetSdk ≤ 32) | **not measured** — no channel yet (Task 10); `POST_NOTIFICATIONS` state and app importance were not captured in any report |
| 16 KB hardware | **not measurable** — device page size is 4096; CI/ELF check covers alignment |

**Phase 1 smoke test on D1 (2026-11-08, installed APK)**

| Check | Result |
|---|---|
| Cold start to first frame | **2.77 s** (3.08 s before the editor chunk was made lazy); splash paints immediately from `index.html` |
| File list from app storage | PASS — directories first, sizes, hidden `.trash` |
| Create file → open in editor | PASS (`hello.py`) |
| Edit → Save | PASS — `print(1+2)` written; dirty dot cleared; "Saved" status |
| Atomic save | PASS by construction (`tmp` → `fsync` → `rename`); note: target is deleted before rename — fixed in Task 4 |
| Terminal | PASS — real PTY (`/system/bin/sh -i`), prompt, `ls` runs, resize, extra keys |
| Theme: system / light / dark | PASS — `data-theme` + system bars update together; choice persists |
| Adaptive launcher icon | PASS — visible in App info (MIUI squircle mask) |
| Undo / redo keys | PASS — typed text reverted and reapplied from the key row |
| Run `.sh` | PASS — `hello from shell` / `slept`, EXIT 0, output coalesced per frame |
| Run `.py` without runtime | PASS (honest failure) — "not run" + hint; no fake success |
| Stop a running script | PASS — EXIT 137 and **no child processes left** (`ps` checked) |
| Run after unsaved edit | PASS — buffer is saved before exec |

**Blocking facts (2026-11-11)**
- **CI has never run:** the branch is local by owner decision; the workflow is YAML-parse-checked only
  (jobs `web`, `android`, `nightly`, `python-runtime`; all 13 `uses:` pinned to SHAs that match their
  version tags). Do not claim green CI. When the owner pushes, run it once and paste the result.
- **D2 is not rooted:** no `su` binary on the LineageOS user build. Phase E (Tasks 17–18) is blocked
  until a root manager is installed; all non-root behaviour is measurable now.
- **16 KB hardware is unavailable:** both phones use 4096-byte pages. Alignment is proven by
  `scripts/check-elf-alignment.sh` (ELF `p_align=0x4000` + `zipalign -P 16`) in CI, not on hardware.
- Android 10–14 have no hardware; they stay unverified (D-014).
- Only one USB cable: D1 runs on Wi-Fi ADB (runbook §1). D1's screen sleeping makes
  `am start -W` hang; `smoke.sh` now wakes the device first.

**Findings from the first device run**
- Shell pipeline throughput is 0.5–4 MB/s (thermal/cache dependent): 25 MB took 6–46 s, 50 MB took 69 s cold. Output buffering must stay bounded (it is), and the terminal UI must coalesce.
- Repeatability: two independent run-all passes (ADB-driven and UI-driven) produced the same PASS set.
- `unzip` is absent from the system shell on Android 9 → archive extraction moves to Kotlin, not a shelled-out tool.
- `git`/`python` are absent as expected: JGit and the CPython package are the only paths.
- 50 MB flood timing is a device property, not a bug — harness now uses 25 MB.

**Verified by unit test** (`./gradlew testDebugUnitTest`, run locally; the CI `android` job exists but has never been observed running)
- `WorkspaceJailTest` (5): relative resolve, absolute-inside-root, `..` rejection, absolute-outside rejection, symlink escape rejection. `Workspace.jail()` is now test-only; production uses `PathJail` (Task 4).
- `WebAppBridgeOriginTest` (6) → `BridgeHostOriginTest` (6), `DevServerConfigTest` (5).
- Task 4: `PathJailTest` (11) covers traversal, absolute paths, `dev.leocodeX`, symlink in/out, shared-storage gating, new files; `AtomicWriterTest` (4) covers replacement and concurrent writers; `TrashTest` (6) covers move, shared trash, purge and missing targets.
- Task 5: `BridgeRouterTest` (9) covers ping, unknown method, version mismatch, missing method, typed errors, redacted `E_INTERNAL` + correlation id, malformed payloads, duplicate registration; `FsHandlerTest` (12) covers the list/read/write/mkdir/rename/delete round-trip, missing parents, traversal and `/system`, `dev.leocodeX`, 2 MB read / 4 MB write limits, binary files, trash deletes and root protection. Suite total: 58.
- Task 6: `ProcessSupervisorTest` (5) covers exit code, stdout/stderr, timeout, cancel, output cap and unsplit UTF-8; `EventSinkTest` (5) covers text/byte coalescing, ordering, the pending cap and base64 after concatenation; `ChildEnvTest` (3) covers the allowlist and overrides; `BridgeRouterTest` grew to 15 with deferred ok/error replies, one-reply, redacted async failure and streaming-before-reply; `SafHandlerTest` (9) covers storage info, permission, SAF open/save, cancel → `null` and the 4 MB cap. Suite total: 86.

---

## 1. Plan v9 tasks

### Phase A — Docs and foundation
- [x] **Task 1** Write the v9 documentation set (plan v9, D-011…D-016, bridge contract, UX error surfaces + root mode, test matrix D2 column, runbook D2/Wi-Fi ADB, compatibility baseline, this tracker)
- [-] **Task 2** Build and CI hygiene, 16 KB alignment — *implemented 2026-11-11, not accepted*: NDK r28.2 pin, hardened 16 KB ELF/zipalign checker with fixture tests (`scripts/tests/run-elf-alignment-tests.sh`, 8/8) + CI, JDK path out of the repo, pinned actions (all 13 SHAs verified against their tags), least-privilege jobs, unit tests + blocking lint with baseline, web ESLint + vitest. **Open:** CI has never run on GitHub (branch not pushed; YAML parse-checked only)
- [-] **Task 3** Device tooling and D2 baseline — *implemented 2026-11-11, not accepted*: `devices.sh`, `smoke.sh`, serial-aware `collect-device-report.sh`; T1–T7 + S1 PASS on both phones with committed harness logs, incl. a final run on the shipped APK. Fix-ups A-01, A-02, A-04…A-09 are done and evidenced. **Open:** CI has never run on GitHub; D2 is unrooted, so Phase E is blocked

#### Phase A fix-ups (from [`docs/reports/phase-a-analysis.md`](docs/reports/phase-a-analysis.md))
- [x] A-01 remove `su -c` from `scripts/` (High)
- [x] A-02 single-phone D1/D2 slot assignment (Medium)
- [x] A-03 `check-elf-alignment.sh`: `set -e`, readelf failures, zero-`.so`, pinned NDK first, RELRO, scan `assets/`, fixture tests (High)
- [x] A-04 smoke/report script defaults, exit codes, harness logcat tag (Low)
- [x] A-05 S1 treats an empty readable root as PASS (Low)
- [x] A-06 no "rooted" label on D2 in `test-matrix.md` (High)
- [x] A-07 matrix numbers match committed logs (Medium)
- [x] A-08 back or soften unsupported claims; re-run and log T2c; one label (Medium)
- [x] A-09 16 KB rows say "static check only" (Medium)
- [x] A-10 Task 2/3 status honest until CI has run (High)
- [x] Evidence added by the reviewer: harness logs for D1 and D2, S1 on D2, read-only verification of root/SELinux/debuggable state (`docs/device-reports/20261111-*`)

### Phase B — Android host restructure
- [x] **Task 4** Fix the path jail and file safety — *done 2026-11-11*: `PathJail` (canonical workspace root + shared storage only while granted; `root + separator` prefix; `..`/symlink/`dev.leocodeX` rejection), `AtomicWriter` (unique temp → fsync → rename over target, never delete-first), `Trash` (same-FS move, shared `.leocode-trash`, copy-then-delete fallback, 30-day purge), 256 KB message / 4 MB write / bounded SAF limits, harness moved to the debug source set. Demo on D1 and D2: `/system/build.prop` and `/sdcard/..` → `E_PATH_OUTSIDE_ROOT`; workspace and `/sdcard` reads/writes work; deletes land in trash (`docs/device-reports/20261111-phaseB-task4-*`)
- [x] **Task 5** Typed error model, `BridgeRouter`, `AppHandler`/`FsHandler`, `AppGraph`/`LeoApp` — *done 2026-11-11*: `ErrorCode` + `BridgeException`, `BridgeRouter` (v check, envelope validation, one reply, typed errors, `E_INTERNAL` = “Something went wrong” + `c-xxxxxx` correlation id logged once), `AppHandler`/`FsHandler` with `@Serializable` DTOs, `AppGraph` + `LeoApp` own the workspace/jail/trash. `app.*` and `fs.*` now go through the router; `proc/term/saf/storage/runtime` stay legacy until Task 6. JSON shapes, limits and trash behaviour unchanged (`docs/device-reports/20261111-phaseB-task5-router-D1.txt`)
- [-] **Task 6** Migrate proc/term/saf/storage; `ProcessSupervisor`; `EventSink` + `term.ack`; delete `WebAppBridge.kt` — *code complete, device re-run pending*. `WebAppBridge.kt` and `ProcessHost` are deleted; the debug harness now runs on `ProcessSupervisor` through a debug-only adapter (`HarnessProcess`), so there is one process path. SAF and permission callbacks are keyed by unique request code. Unit tests: 88 pass (ProcessSupervisor 5, EventSink 5, ChildEnv 3, router 15, SAF 9). **Open:** harness T1–T7 + S1 and the `yes`/Stop demo must be re-run on D1 and D2 with this APK (both phones unreachable this session); `RuntimeInstaller` still has its own process launcher and env until Task 25 (see [`docs/reports/task6-7-verification.md`](docs/reports/task6-7-verification.md) §1)
- [-] **Task 7** Generated TS types (`generateBridgeTypes`, CI drift check) — *code complete, CI not run*. Generator emits `ERROR_CODES` (runtime list), `ErrorCode` and `isErrorCode`; `BridgeError.code` is typed; unknown host codes map to `E_INTERNAL`. Kotlin `BridgeTypesCoverageTest` fails if a DTO or error code is missing from the output; web `generated.test.ts`. CI android job fails on a stale `types.gen.ts`. Demo done: renaming a DTO field makes the drift check and `tsc` fail until fixed (evidence in [`docs/reports/task6-7-verification.md`](docs/reports/task6-7-verification.md) §3). **Open:** the CI step has not run on GitHub.
- [-] **Task 8** Activity modernisation and crash recovery — *code complete, device demo pending*. `ComponentActivity` + ActivityResult queues (SAF open/save, permissions), `OnBackPressedDispatcher`, edge-to-edge `WindowInsetsCompat` → `--inset-top/--inset-bottom/--ime-bottom`, renderer-loss rebuild + “Restored after a problem” (two losses in 60 s → `RecoveryActivity`), asset-origin error page with Retry, `CrashStore` + redacting `Redactor` + native `RecoveryActivity` (Restart / Share diagnostics), strict CSP with a dev-only HMR policy, bundled Fira Code / JetBrains Mono / Roboto Mono / Source Code Pro, and `Redactor` + `security.test.ts` tests. **Open:** the D1/D2 demo (renderer kill, forced crash, back order) — both phones unreachable this session; see [`docs/reports/task8-verification.md`](docs/reports/task8-verification.md).
- [ ] **Task 9** Native PTY correctness (`execve` envp, close fds, signals, `ptsname_r`); harness T8, T9
- [ ] **Task 10** `SessionService` (foreground), `term.attach`, `OrphanReaper`, phantom-process / MIUI guide

### Phase C — Web restructure and error UX
- [ ] **Task 11** Bridge client: timeouts, `AbortSignal`, disconnect, typed `AppError`
- [ ] **Task 12** Error UX system: snackbar, banner, error sheet, catalog, ErrorBoundary, CrashScreen; no silent `catch {}`
- [ ] **Task 13** Split `App.tsx` into `features/*` + Zustand stores; `Shell` < 200 lines

### Phase D — Workspace and editor completeness
- [ ] **Task 14** Workspaces, SAF import/export, zip backup, uninstall warning
- [ ] **Task 15** Drafts + crash recovery, external-change detection, large-file mode, find/replace
- [ ] **Task 16** Workspace search (`fs.search` streaming)

### Phase E — Root mode
- [ ] **Task 17** `RootManager` (libsu), Root mode setting, warning, ROOT badge
- [ ] **Task 18** Root terminal session and Run as root (`su -c`, kill via `su`)

### Phase F — Git and SSH (after Python, D-017)
- [ ] **Task 19** JGit + MINA SSHD spike (T10–T13) → D-016
- [ ] **Task 20** `SecretStore` (Keystore envelope); harness T14
- [ ] **Task 21** Local Git operations + Git tab
- [ ] **Task 22** Remote operations + conflicts
- [ ] **Task 23** SSH key manager + host-key prompt

### Phase G — Python, the primary language (D-017; do right after Phase C)
- [-] **Prototype** committed as-is in `1a279a2` (installer, launcher, runtime bridge methods, UI). Not accepted; replaced task by task. Defects P-01…P-10 in the Phase A report
- [ ] **Task 24** CI Python artifact (official build + launcher + pip + certs, signed manifest, markupsafe wheel); retire `build-python.sh`. Can start any time after Task 2 is green
- [ ] **Task 25** Runtime installer (verify, resumable download, safe extraction, health check). Needs Task 4 first
- [ ] **Task 26** Python integration, venv, `requirements.txt`, trust prompts; harness T15; `compatibility.md`
- [ ] **Task 30** `LanguageProvider` interface + Python provider (nothing outside it hard-codes `python`)
- [ ] **Task 31** Python run experience: `input()`, tappable tracebacks, plain-language error summaries, run configs
- [ ] **Task 32** Python REPL, per-project `.venv`, `requirements.txt` install, pip failure explanations
- [ ] **Task 33** Python editor experience (indentation, snippets, formatter decision), project template, in-app compatibility page

### Phase H — Hardening and release
- [ ] **Task 27** Onboarding (3 screens) + Diagnostics screen
- [ ] **Task 28** Release keystore, R8, signed releases + SBOM, signed nightly prerelease, self-update
- [ ] **Task 29** Hardening tests, soak, accessibility, performance budgets, full matrix, 0.1 go/no-go

### Deferred
- [~] Track C1 userspace rebuild (termux-packages fork)
- [~] Node.js (npm, Vite, preview), Java, PHP — after 0.1, added as language providers (D-017) only once Python meets plan §9.1
- [~] Local web preview (D-010) — post-Node
- [~] Degraded WebView mode — policy only, built if a device needs it
- [~] Termux GPL terminal view — only if the app goes GPL
- [~] Root file browsing (D-011 reopen trigger)

---

## 2. Known debt → fixing task

| Debt | Task |
|---|---|
| `WebAppBridge.resolve()` bypasses the path jail (absolute paths anywhere, no symlink resolution, `dev.leocodeX` prefix bug) | 4 — fixed 2026-11-11 |
| `HarnessActivity` exported in the main manifest | 4 — fixed 2026-11-11 |
| `fs.write` deletes the target before rename; temp name collides; trash falls back to permanent delete | 4 — fixed 2026-11-11 |
| No message / write / SAF size limits | 4 — fixed 2026-11-11 |
| `WebAppBridge.kt` 728-line single `when`, untyped payloads, raw threads, unbounded pool | 5 (`app.*`/`fs.*`), 6 (rest) — fixed 2026-11-11 |
| String-literal error codes; `E_INTERNAL` leaks exception text; `v` never checked | 5 — fixed 2026-11-11 |
| `ProcessHost` and `runProcess` duplicate process launch; PTY child inherits full app env | 6 — fixed 2026-11-11; `pty.c` envp still 9 |
| No backpressure on process/terminal events | 6 — fixed 2026-11-11 |
| SIGTERM and SIGKILL sent back to back | 6 — fixed 2026-11-11 |
| Single-slot SAF / permission callbacks (second request never answered) | 6 — fixed 2026-11-11 |
| Bridge types hand-written in TS | 7 |
| Plain `Activity`, deprecated `onBackPressed`, `startActivityForResult`, `systemUiVisibility` | 8 |
| No `onRenderProcessGone`, no crash handler, no crash reporting | 8 |
| No CSP; Google Fonts loaded at runtime | 8 |
| `androidx.webkit` logs a harmless `NoClassDefFoundError` for an API-29 class on Android 9 | 8 (re-check after bump) |
| `pty.c`: `setenv` after fork, inherited fds, signals not reset, `ptsname` | 9 |
| Sessions die with the Activity; no foreground service; phantom-process killer | 10 |
| Bridge requests have no timeouts; `run()` exit promise can hang forever | 11 |
| Android detected by user agent | 11 |
| No ErrorBoundary; errors reduced to `e.message`; silent `catch {}` blocks | 12 |
| `App.tsx` `Shell` ≈ 970 lines; `styles.css` 2 488 lines | 13 |
| Rename and delete not exercised on device | 13 (parity demo) |
| No external-change detection or autosave | 15 |
| **D2 has no `su`** (LineageOS user build): Phase E root tests are blocked until a root manager is installed | 17 (blocker) |
| No instrumented tests (web unit tests now exist) | each task (tests) |
| JGit / SSHD / Bouncy Castle declared but unused | 19 |
| `scripts/build-python.sh` custom CPython build | 24 (retired) |
| Python prototype defects P-01…P-10 (unsigned install, laptop-built launcher, unsafe extraction, non-atomic swap, staging shebangs, global `LD_LIBRARY_PATH`, no on-device run) — see Phase A report §4 | 24, 25, 26, 30 |
| Phase A script/evidence defects A-01…A-10 — see Phase A report §3 | Phase A fix-ups |
| Debug APK 28.8 MB, R8 off, release signed with debug key, public debug APK on push | 28 |
| `targetSdk 28` lint rule intentionally disabled — **do not "fix"** (D-002) | — |

Fixed by Phase A: JDK path moved to `~/.gradle/gradle.properties`; CI pins actions and the NDK,
runs unit tests and blocking lint (baseline), and enforces 16 KB alignment; web has ESLint +
vitest. See Task 2 above.

---

## 3. Done before v9 (history)

Completed under plan v8; kept for traceability.

**Gate 0** — D-001…D-010 recorded; repo scaffold; CI workflow definitions; `git init`; repo published to GitHub (`souravrouth5/leocode-ide`).

**0A** — SDK/NDK (`~/Android/Sdk`: platform 34, build-tools 34.0.0, CMake 3.22.1, NDK 27.0.12077973) and JDK 17 (`~/jdk17`) installed; local Gradle build; D1 developer options + USB debugging; D1 device report and WebView 137 captured; WebView gate PASS on D1; targetSdk-28 APK installed on D1.

**0B** — `Workspace`, `ProcessHost`, output ring buffer, harness UI + `am start --es run`, JNI `setsid` + group kill; T1–T7 run on D1 (all PASS / INFO); results in `docs/test-matrix.md`.

**0C** — draft `scripts/build-python.sh` (to be replaced, D-012).

**0D** — dependencies chosen and declared (JGit, MINA SSHD, Bouncy Castle).

**0E** — `pty.c` scaffold, Kotlin `Pty` wrapper, xterm.js component, `libleocodepty.so` built for arm64-v8a, PTY smoke test PASS on D1.

**Phase 1** — mock bridge + browser dev mode; web UI scaffold; bridge contract v1 draft; Gradle wrapper 8.9; code-split bundle (xterm and CodeMirror lazy); `scripts/sync-web.sh`; `MainActivity` + `WebViewAssetLoader`; `addWebMessageListener` bridge with origin check; file CRUD; properties sheet; explorer search, 6-mode sort, binary/dotfile filters; React-portal sheets; navigation + settings; error sheet + status bar; theme manager with system bars; launcher icons.

**Phase 2 (partial)** — CodeMirror 6 with 12 language modes; keyboard accessory rows; bracket matching / close-brackets; undo/redo keys; Run badge; run sheet with save-before-run, live output, Stop, bounded scrollback; CRLF/LF-normalised dirty tracking; `+` untitled documents with Save As; multi-tab session restore; terminal wired to native PTY (base64, resize, restart); terminal lifecycle with no leaks observed.

**Phase 4 (partial)** — runtime catalogue UI (size, version, disk used).

---

## Changelog

| Date | Change |
|---|---|
| 2026-11-08 | Repo scaffolded; plan v8 written; Android harness, JNI PTY, web IDE shell, CI added. |
| 2026-11-08 | APK built (Gradle 8.9 / AGP 8.5.2 / NDK r27) and installed on the Redmi Note 7S. Device report captured: Android 9, arm64-v8a, PAGE_SIZE 4096, WebView 137. |
| 2026-11-08 | **Phase 0B gate PASS on Android 9**: T1 shell exec, T2 exec-from-app-data (W^X), T3 group kill, T4 exit codes, T5 bounded 25 MB flood, T6 native PTY. Results in `docs/test-matrix.md`. |
| 2026-11-08 | T5 resized 50 MB → 25 MB after measuring 0.7 MB/s shell throughput; harness now drives from ADB (`--es run all`). |
| 2026-11-08 | **Phase 1 milestone: real IDE in the APK.** WebView host + asset loader, v1 bridge (fs/proc/term/theme), real files in app storage, native PTY terminal, light/dark/system themes with system-bar sync, keyboard accessory rows, boot splash. Verified on device: create/open/edit/save, terminal, theme switching. |
| 2026-11-08 | Web bundle split: editor (CodeMirror) and terminal (xterm) are lazy chunks; cold start to first frame 3.08 s → 2.77 s. |
| 2026-11-08 | New launcher artwork; generated adaptive, round and legacy icons plus `design/app-icon.png` source. |
| 2026-11-08 | Repository published to GitHub (`souravrouth5/leocode-ide`); CI becomes runnable. |
| 2026-11-08 | Runtime Manager UI (Python 3, Node.js, Java OpenJDK, C/C++ toolchain, Shell) with live probe & env inspection; dedicated LeoCode SVG logo brand mark; boot splash styling; file reload & workspace refresh; reinstalled APK to device with MIUI launcher cache reset. |
| 2026-11-08 | **File Explorer, Editor & CI Release Enhancements**: properties sheet; search and 6-mode sort; binary and dotfile filters; PHP, Rust, SQL, XML, YAML and Shell highlighters; untitled doc flow with unsaved indicator; CRLF/LF dirty tracking; session persistence guard; Run badge; portal sheets; GitHub Actions nightly APK on push to `main`. |
| 2026-11-11 | **Plan v9** (Task 1): production-readiness audit; v9 replaces v8 (kept as history). New decisions D-011 optional root mode, D-012 official python.org CPython, D-013 local-only diagnostics, D-014 device matrix (D1 Android 9 unrooted + D2 Android 15 rooted, no emulators), D-015 manual DI + Zustand, D-016 JGit version (open). Bridge contract gains error codes, timeouts, root/workspace/git/ssh/runtime methods; UX spec gains error surfaces and root mode; test matrix gains a D2 column and T8–T15; tracker rebuilt around Tasks 1–29. No code changed. |
| 2026-11-11 | **Task 2 build/CI hygiene**: NDK pinned to r28.2.13676358 (16 KB default + explicit `max-page-size`), JDK path moved to `~/.gradle/gradle.properties`, `scripts/check-elf-alignment.sh` (llvm-readelf + `zipalign -P 16`) in CI, actions pinned to SHAs, least-privilege per-job permissions, `./gradlew` unit tests + blocking lint with baseline, web ESLint + vitest + sample tests, nightly moved to its own least-privilege job. Builds and installs on D1/D2. |
| 2026-11-11 | **Task 3 D2 baseline**: `scripts/devices.sh` (serial resolution, model/API/page-size/WebView/root), `scripts/smoke.sh` (install + cold start + logcat, wakes the device), serial-aware `collect-device-report.sh`; D2 POCO F1 (LineageOS, Android 15) report captured. T1–T7 and S1 shared-storage PASS on both phones; T2c targetSdk-29 control build fails exec with `error=13` as designed; D2 cold start 0.941 s, WebView 156, PAGE_SIZE 4096, no old-target dialog. **D2 has no `su`** (Phase E blocked). |
| 2026-11-11 | **Runtime tab honest empty state**: the old "Install / Setup" stub opened a modal that implied an install and offered "Open Terminal", which only changed tabs. The card is now "Setup info" and opens an "Installation unavailable" notice explaining that no runtime package/installer ships in this build, that nothing was changed on-device, and offering the system shell. Runtime probe failures now show an error badge and a retry banner instead of masquerading as "Not installed". Real install remains Tasks 24–25 (manifest is still a placeholder). |
| 2026-11-11 | **Phase A review.** Full web + Android checks pass; harness T1–T7 + S1 pass on D1 and D2 (logs committed). D2 verified unrooted (no `su`, no root manager). Findings A-01…A-19 and P-01…P-10 written up in `docs/reports/phase-a-analysis.md`; Tasks 2 and 3 reopened until fixed. Python installer prototype committed as-is (`1a279a2`). **Plan change:** D-017 makes Python the primary language; Phase G moves ahead of D/E/F; Tasks 30–33 added (language provider, run experience, REPL + packages, editor + template). |
| 2026-11-11 | **Tasks 6–7 completion.** Debug harness moved to `ProcessSupervisor` (`HarnessProcess` adapter), `ProcessHost` deleted; T3 group kill now uses `cancel`. Generator emits `ERROR_CODES` and `isErrorCode`; `BridgeError.code` typed; CI drift check added. Verification: 88 Android unit tests, lint, debug build, 16 KB check, web checks all pass; type-drift demo passed (`docs/reports/task6-7-verification.md`). Device re-run of T1–T7 + S1 and the `yes`/Stop demo pending: both phones unreachable this session. |
