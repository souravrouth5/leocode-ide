# LeoCode — Progress Tracker

**Last updated:** 2026-11-11
**Current phase:** Plan v9, Phase A. Task 1 (v9 docs) done. Next: Task 2 (build/CI hygiene, 16 KB
alignment), then Task 3 (D2 Android 15 baseline). Phase 0 gates 0B/0E still PASS on D1.
**Plan:** [`docs/LeoCode_Implementation_Plan_v9.md`](docs/LeoCode_Implementation_Plan_v9.md) (v8 is history)

Status key: `[ ]` not started · `[-]` in progress · `[x]` done · `[!]` blocked · `[~]` deferred

---

## 0. Snapshot

| Area | State |
|---|---|
| Plan + decisions | **v9** (D-001…D-016; D-016 open until Task 19) |
| Devices | D1 Redmi Note 7S, Android 9, unrooted — measured. D2 custom ROM, Android 15, rooted — **not yet measured** (Task 3) |
| Android app (real IDE shell) | Built and installed on D1 (`app-debug.apk`, versionCode 2, targetSdk 28). **Not production-grade** — see §2 |
| Web IDE shell | Live on D1 — collapsible file explorer with search, 6-mode sort, properties sheet, binary & dotfile filters, shared-storage browsing, multi-tab editor with session restore, live PTY terminal, runtime manager UI |
| Branding & mascot | Puppy coder mascot (`design/app-icon.png`) on launcher, splash and app bar |
| Theme & settings | System/Light/Dark, 6 syntax themes, font picker, font size stepper |
| Code formatting | In-browser Prettier for JS, TS, HTML, CSS, Markdown, JSON |
| Syntax highlighting | Python, JS, TS, HTML, CSS, JSON, PHP, Rust, SQL, XML, YAML, Shell |
| Run + undo/redo | Run badge, live output sheet with Stop (process-group kill), undo/redo keys |
| CI / CD | Builds on push; publishes a **debug** APK as `nightly` (to become a signed prerelease, Task 28) |
| Python runtime | UI wired to device probe; package build moves to the official python.org build (D-012, Task 24) |
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
| T5 flood, bounded | **PASS** — 25 MB in 6–46 s (warm/cold), captured exactly 256 KB |
| T6 native PTY | **PASS** — output, cols=80, exit 7 |
| T7 applets | INFO — no `unzip`, `git`, `python` |

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
- D2 (Android 15, rooted) has not been measured yet. Android 15 gates (install floor, exec from
  app data, 16 KB pages, WebView ≥ 100) are unproven until Task 3.
- Android 10–14 have no hardware; they stay unverified (D-014).
- Only one USB cable: D1 runs on Wi-Fi ADB (runbook §1).

**Findings from the first device run**
- Shell pipeline throughput is 0.5–4 MB/s (thermal/cache dependent): 25 MB took 6–46 s, 50 MB took 69 s cold. Output buffering must stay bounded (it is), and the terminal UI must coalesce.
- Repeatability: two independent run-all passes (ADB-driven and UI-driven) produced the same PASS set.
- `unzip` is absent from the system shell on Android 9 → archive extraction moves to Kotlin, not a shelled-out tool.
- `git`/`python` are absent as expected: JGit and the CPython package are the only paths.
- 50 MB flood timing is a device property, not a bug — harness now uses 25 MB.

**Verified by unit test** (`./gradlew testDebugUnitTest`, all pass locally; not run in CI yet — Task 2)
- `WorkspaceJailTest` (5): relative resolve, absolute-inside-root, `..` rejection, absolute-outside rejection, symlink escape rejection. **Caveat:** production `WebAppBridge.resolve()` does not call `jail()` (Task 4).
- `WebAppBridgeOriginTest` (6), `DevServerConfigTest` (5).

---

## 1. Plan v9 tasks

### Phase A — Docs and foundation
- [x] **Task 1** Write the v9 documentation set (plan v9, D-011…D-016, bridge contract, UX error surfaces + root mode, test matrix D2 column, runbook D2/Wi-Fi ADB, compatibility baseline, this tracker)
- [ ] **Task 2** Build and CI hygiene, 16 KB alignment
- [ ] **Task 3** Device tooling (`devices.sh`, `smoke.sh`) and D2 baseline (T1–T7, WebView, page size, install, warning dialog)

### Phase B — Android host restructure
- [ ] **Task 4** Fix the path jail (allowed roots: workspaces + shared storage when granted) and file safety; `HarnessActivity` → debug source set
- [ ] **Task 5** Typed error model, `BridgeRouter`, `AppHandler`/`FsHandler`, `AppGraph`/`LeoApp`
- [ ] **Task 6** Migrate proc/term/saf/storage; `ProcessSupervisor`; `EventSink` + `term.ack`; delete `WebAppBridge.kt`
- [ ] **Task 7** Generated TS types (`generateBridgeTypes`, CI drift check)
- [ ] **Task 8** `ComponentActivity`, insets, back dispatcher, renderer-gone recovery, crash handler + `RecoveryActivity`, CSP, local fonts
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

### Phase F — Git and SSH (parallel with G)
- [ ] **Task 19** JGit + MINA SSHD spike (T10–T13) → D-016
- [ ] **Task 20** `SecretStore` (Keystore envelope); harness T14
- [ ] **Task 21** Local Git operations + Git tab
- [ ] **Task 22** Remote operations + conflicts
- [ ] **Task 23** SSH key manager + host-key prompt

### Phase G — Python (CI parallel with F)
- [ ] **Task 24** CI Python artifact (official build + launcher + pip + certs, signed manifest, markupsafe wheel); retire `build-python.sh`
- [ ] **Task 25** Runtime installer (verify, resumable download, safe extraction, health check)
- [ ] **Task 26** Python integration, venv, `requirements.txt`, trust prompts; harness T15; `compatibility.md`

### Phase H — Hardening and release
- [ ] **Task 27** Onboarding (3 screens) + Diagnostics screen
- [ ] **Task 28** Release keystore, R8, signed releases + SBOM, signed nightly prerelease, self-update
- [ ] **Task 29** Hardening tests, soak, accessibility, performance budgets, full matrix, 0.1 go/no-go

### Deferred
- [~] Track C1 userspace rebuild (termux-packages fork)
- [~] Node.js (npm, Vite, preview), Java, PHP — after 0.1
- [~] Local web preview (D-010) — post-Node
- [~] Degraded WebView mode — policy only, built if a device needs it
- [~] Termux GPL terminal view — only if the app goes GPL
- [~] Root file browsing (D-011 reopen trigger)

---

## 2. Known debt → fixing task

| Debt | Task |
|---|---|
| `WebAppBridge.resolve()` bypasses the path jail (absolute paths anywhere, no symlink resolution, `dev.leocodeX` prefix bug) | 4 |
| `HarnessActivity` exported in the main manifest | 4 |
| `fs.write` deletes the target before rename; temp name collides; trash falls back to permanent delete | 4 |
| No message / write / SAF size limits | 4 |
| `WebAppBridge.kt` 728-line single `when`, untyped payloads, raw threads, unbounded pool | 5, 6 |
| String-literal error codes; `E_INTERNAL` leaks exception text; `v` never checked | 5 |
| `ProcessHost` and `runProcess` duplicate process launch; PTY child inherits full app env | 6, 9 |
| No backpressure on process/terminal events | 6 |
| SIGTERM and SIGKILL sent back to back | 6 |
| Single-slot SAF / permission callbacks (second request never answered) | 6 |
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
| `org.gradle.java.home` hard-coded in `android/gradle.properties` | 2 |
| CI: unit tests not run, lint non-blocking, actions unpinned, global `contents: write`, NDK fallback mismatch, system `gradle` instead of `./gradlew` | 2 |
| No 16 KB page alignment for `libleocodepty.so` | 2 |
| No web tests or ESLint; no instrumented tests | 2 (tooling), each task (tests) |
| JGit / SSHD / Bouncy Castle declared but unused | 19 |
| `scripts/build-python.sh` custom CPython build | 24 (retired) |
| Debug APK 28.8 MB, R8 off, release signed with debug key, public debug APK on push | 28 |
| `targetSdk 28` lint rule intentionally disabled — **do not "fix"** (D-002) | — |

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
