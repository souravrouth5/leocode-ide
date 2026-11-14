# LeoCode — Progress Tracker

**Last updated:** 2026-11-14
**Current phase:** Plan v9. Phase A fix-ups A-01…A-10 are done and the local exit gate was green
(2026-11-11). Phase B: **Tasks 4–7 are done**; **Tasks 8–10 are code-complete and verified on
D1/D2** (2026-11-14). Phase C: **Tasks 11–13 are done**. **Phase D (Tasks 14–16) is code-complete**
with JVM + web gates green (2026-11-14; [`docs/reports/task14-16-verification.md`](docs/reports/task14-16-verification.md))
and reviewed: 25 findings PD-01…PD-25 in [`docs/reports/phase-d-analysis.md`](docs/reports/phase-d-analysis.md)
(2 High: workspace-registry reset on a corrupt index, `window.prompt`/`confirm` no-ops in the WebView);
only the D1/D2 device pass is pending. **Phase B/C review fixes are done through batch 6**
(2026-11-14; [`docs/reports/phase-b-c-fixes.md`](docs/reports/phase-b-c-fixes.md)); only the narrow
remainders listed there stay open. Tasks 2 and 3 stay `[-]` until CI has run on GitHub: the branch is
now pushed, but the repo token cannot read Actions results, so the owner must confirm the run. D2 is
measured but **unrooted** (no `su`); the owner will root it before Phase E.
**Plan:** [`docs/LeoCode_Implementation_Plan_v9.md`](docs/LeoCode_Implementation_Plan_v9.md) (v8 is history)

Status key: `[ ]` not started · `[-]` in progress · `[x]` done · `[!]` blocked · `[~]` deferred

### Review fixes (Phase B/C analysis, 2026-11-14)

The read-only review produced 105 findings. The crash/data-loss/contract/concurrency batches and the
follow-up privacy, lifecycle and editor batches are fixed with tests and device smoke:

| Batch | Commit | IDs fixed |
|---|---|---|
| 1. Data loss/crashes | `8889bac` | S-01, S-02, S-13, L-01, L-02, L-07, B-01, S-10/S-11/B-10, W-02, W-03, W-04, W-16 |
| 2. Contract/timeouts | `4b4e9a1` | B-03/W-01, B-04, B-06, B-18, B-19, W-07, W-08, W-37 |
| 3. Terminal/process | `cad444a` | B-02/L-04, B-05, B-11, B-12/L-03, L-05, L-12, L-13, B-07, B-08, B-09, B-21, W-20, W-21, W-22 |
| 4 web privacy | `640ac2d` | W-09, W-11, W-23 |
| 4 Android lifecycle | `4f6c7f8` | L-09, L-10, L-11, L-14, L-20, B-17 |
| 5 Android files | `4a72324` | S-03, S-04, S-05, S-07, S-08, S-09, S-12 |
| 5/6 web editor+UX | `2467948` | W-05, W-10, W-12…W-19, W-24, W-26…W-29, W-32, W-34, W-35, W-36 |
| 6 partial terminal | `56fc5bf` | L-16, L-17, L-18, L-19, L-21, L-22 |

**Still open (narrow):** L-06 (reaper
when the group leader is gone), L-08 (detach on `onStop`), L-15 (wake lock), L-24 (back timeout),
S-15/S-16/S-17/S-18 (fsync, `.tmp` sweep, SAF binary, purge off-path), S-19/S-20, B-15/B-16,
W-25 (large-file perf), W-30/W-31/W-33/W-38. W-06 conflict detection is fixed by Task 15
(`fs.stat` + `expectedHash`); W-25 is narrower now that large files open read-only with one chunk. Device checks still pending: S-12 case-only rename on
shared storage, L-09 renderer kill while backgrounded, W-24 visual scroll, W-18 CRLF, W-12 run-hide.
B-09 uses the report's cancel-on-finish alternative; terminals still reattach. `runtime.install` has
no client timeout until Task 25. Full details: [`docs/reports/phase-b-c-fixes.md`](docs/reports/phase-b-c-fixes.md);
the review copies are in `docs/reports/review-parts/`.

---

## 0. Snapshot

| Area | State |
|---|---|
| Plan + decisions | **v9** (D-001…D-017; D-016 open until Task 19; **D-017 Python is the primary language**) |
| Devices | D1 Redmi Note 7S, Android 9, unrooted — measured. D2 POCO F1, Android 15, **unrooted (no `su`)** — measured 2026-11-11 (Task 3) |
| Android app (real IDE shell) | Built and installed on D1 and D2 (`app-debug.apk`, versionCode 2, targetSdk 28). The CI workflow (NDK r28, unit tests + blocking lint, 16 KB alignment check) **has never run on GitHub** — it is YAML-parse-checked only. **Not production-grade** — see §2 |
| Web IDE shell | Live on D1 — collapsible file explorer with search, 6-mode sort, properties sheet, binary & dotfile filters, shared-storage browsing, multi-tab editor with session restore, live PTY terminal, runtime manager UI. **Phase D (code complete, device pass pending):** workspace switcher, SAF folder import, zip backup/restore, draft autosave + recovery, external-change Reload / Keep mine, large-file read-only mode, find/replace and streaming workspace search |
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
| Notification prompt (A13+, targetSdk ≤ 32) | **implemented, not measured** — `POST_NOTIFICATIONS` is requested when the first terminal/job starts (Task 10); channel + app importance still need a device capture |
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
- [-] **Task 9** Native PTY correctness — *code complete, harness run pending*. `pty.c` now builds a NULL-terminated `envp` before `fork()` and calls `execve` (no `setenv` after fork), closes every fd above stderr (`close_range`/bounded loop), resets the signal mask and dispositions, uses `ptsname_r`, and checks `TIOCSCTTY`. `PtySession.write/read/resize` stop after `close()`. Harness **T8** (child environment equals the `ChildEnv` allowlist) and **T9** (`open_above_2=0`) use native probes that share the production setup path. **Open:** T6/T8/T9 on D1 and D2 — no device attached; see [`docs/reports/task9-verification.md`](docs/reports/task9-verification.md).
- [x] **Task 10** Background survival — *done and device-verified 2026-11-14*. `TerminalRegistry` owns PTYs outside the Activity, keeps a 256 KB per-session `RingBuffer`, and streams to one attached listener with the existing credit window; `term.open` and `term.attach` reply before streaming, `term.attach` replays base64 scrollback, `term.list` lists sessions. `SessionService` is a foreground service with “N processes running” + **Stop all** (channel created on the first session; `POST_NOTIFICATIONS` requested from the first session on Android 13+). `OrphanReaper` + `PidFileStore` kill leftover process groups on the next start, guarded by `/proc` start time. Activity/WebView destruction now calls `detachBridge()`; the web terminal stores its session id and reattaches. Settings documents MIUI autostart/battery, the Android 12+ phantom-process killer and the rooted `max_phantom_processes` option. Unit tests: `RingBufferTest`, `TerminalRegistryTest`, `OrphanReaperTest`, pidfile case in `ProcessSupervisorTest`. Device runs: D2 `sleep 600; echo done` backgrounded >10 min → `done` + prompt, no new banner; D1 session survived rotation and a forced Activity recreation with the same pid and replayed scrollback; notification + Stop all confirmed on both. Fixed while testing: the FGS start/stop race (A15 crash), `term.open` never attaching a listener, and `close_range` SIGSYS on API 28. `scripts/device.sh` added for repeatable runs. See [`docs/reports/task10-verification.md`](docs/reports/task10-verification.md).

### Phase C — Web restructure and error UX
- [x] **Task 11** Bridge client: timeouts, `AbortSignal`, disconnect, typed `AppError` — *done 2026-11-14*. Per-method defaults from the contract (10 s fast / 20 s write / none for pickers; streamed methods time the reply-on-start only), `RequestOptions` with cancel and override, single-settle pending cleanup (late replies dropped), `disconnect()` + `leocode:bridge-disconnected` → `E_BRIDGE_DISCONNECTED`, `AppError` typed by the generated codes, one retry for idempotent reads, and Android detected by the injected channel instead of the UA. Tests: 13 new transport/policy cases plus the `?simulate` integration tests. See [`docs/reports/task11-verification.md`](docs/reports/task11-verification.md).
- [x] **Task 12** Error UX system — *done 2026-11-14*. `errors/catalog.ts` covers every generated code (surface, severity, one action); `notifications` store (snackbar queue, actions, undo-ready) and `errors` store route each failure to a snackbar, an inline banner or a sheet; `ErrorSheet` (explanation, primary action, Copy details), `InlineBanner`, `Snackbar`, per-pane `ErrorBoundary` + `PaneError`, app `CrashScreen`, `lazyWithRetry` for stale chunks, global `error`/`unhandledrejection` handlers, and every silent `catch {}` replaced (session restore reports missing tabs, storage failures warn once). `?simulate=<code>` demos each surface. Tests: catalog coverage, routing, all surfaces, and app-level `?simulate` integration. See [`docs/reports/task12-verification.md`](docs/reports/task12-verification.md).
- [x] **Task 13** Split `App.tsx` into features and stores — *done and device-verified 2026-11-14*. `App.tsx` is boot only (128 lines); `features/shell/Shell.tsx` is 84 lines and composes feature views. Zustand vanilla stores (`settings`, `shell`, `files`, `editor`, `run`, plus notifications/errors) are built once by `createAppStores(bridge)` manual DI and provided by context. Terminal session persistence moved to `features/terminal/session.ts`; OSC 0/2 titles are sanitised and OSC 52 is swallowed. `styles.css` split into 22 files under `web/src/styles/` with the original cascade order. Tests: files, editor, run, terminal helpers and a mock-mode shell smoke test — **57 web tests**. D1 parity: boot, drawer/file list, open `hello.sh`, Run sheet (`EXIT 0`), terminal PTY, Runtimes, rename (tab followed) and delete (moved to `.trash`). See [`docs/reports/task13-verification.md`](docs/reports/task13-verification.md).

### Phase D — Workspace and editor completeness
- [x] **Task 14** Workspaces, SAF import/export, zip backup, uninstall warning — *code complete 2026-11-14, device pass pending*. `WorkspaceStore` registry (`filesDir/workspaces.json`, `workspace/workspaces/<id>`), `workspace.list/create/open/rename/delete` (`list` = `{ active, workspaces }`), active-root path jail, top-bar switcher, `saf.importTree` (never overwrites), `saf.exportWorkspace` (streaming zip), `saf.restoreArchive` (strict zip-slip/size caps, temp-file atomic replace), `saf.progress { phase, files, bytes }`, Settings Backup & Import and the uninstall warning. JVM: `WorkspaceStoreTest`, `ZipBackupTest`, `WorkspaceHandlerTest`, expanded `SafHandlerTest`. Web: `workspaceStore.test.ts`, `mock.phaseD.test.ts`.
- [x] **Task 15** Drafts + crash recovery, external-change detection, large-file mode, find/replace — *code complete 2026-11-14, device pass pending*. `FileHash` + `Drafts` (`filesDir/drafts/<workspaceId>/<sha256(path)>.json`), `draft.list/read/save/delete`, 3 s idle autosave, recovery/discard banner, `fs.stat` + chunked `fs.read` + `writeChecked` (`E_CONFLICT`), 5 s external-change poll with Reload / Keep mine, >1 MB read-only large-file mode, find/replace sheet driving CodeMirror search commands. JVM: `DraftsTest`, `FileHashTest`, `DraftHandlerTest`. Web: `editorPhaseD.test.ts`.
- [x] **Task 16** Workspace search (`fs.search` streaming) — *code complete 2026-11-14, device pass pending*. `SearchEngine` ignores `.git`/`node_modules`/`.venv`/`__pycache__`, glob + case options, capped (default 500, max 2 000), cancellable via client `searchId`; streaming `search.match` into a search sheet with jump-to-line. JVM: `SearchEngineTest`, `SearchHandlerTest`. Web: `searchStore.test.ts`.

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
| `App.tsx` `Shell` ≈ 970 lines; `styles.css` 2 488 lines | 13 — fixed 2026-11-14 (Shell 84 lines, styles split) |
| Rename and delete not exercised on device | 13 — verified on D1 2026-11-14 (rename follows the tab, delete lands in `.trash`) |
| No external-change detection or autosave | 15 — fixed 2026-11-14 (drafts, `fs.stat`, `expectedHash`) |
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
| 2026-11-14 | **Task 10 background survival, device-verified.** `TerminalRegistry` owns PTYs, `term.attach` replays scrollback before live data, `SessionService` shows “N processes running” + Stop all, `OrphanReaper` kills stale groups. D2: `sleep 600; echo done` survived >10 min backgrounded and reattached with `done`; D1: the shell survived rotation and a forced Activity recreation (same pid) and replayed scrollback; notification + Stop all captured on both. Three defects fixed on the way: FGS stop race crash on Android 15, `term.open` never attaching a stream, and `close_range()` SIGSYS on API 28. Added `scripts/device.sh` for repeatable adb runs; the APK now ships a freshly synced web bundle. |
| 2026-11-14 | **Task 11 bridge client.** Per-method timeout table from the contract, `RequestOptions` (`signal`, `timeoutMs` override), single-settle pending cleanup with late replies dropped, `disconnect()` + `leocode:bridge-disconnected` → `E_BRIDGE_DISCONNECTED`, typed `AppError` from the generated codes, one retry for idempotent reads, Android detected by the injected channel (not the UA). 13 transport/policy tests. |
| 2026-11-14 | **Task 12 error UX.** Catalog for every generated `ErrorCode` with one action, notifications (snackbar) + errors (banner/sheet) stores, `InlineBanner` / `ErrorSheet` / `Snackbar`, per-pane `ErrorBoundary` + `PaneError`, app `CrashScreen`, `lazyWithRetry`, global `error`/`unhandledrejection` handlers, `?simulate=<code>` demo switch, and no silent `catch {}`. Device demo on D1: cancelled SAF picker → “No document selected” snackbar. 42 web tests. |
| 2026-11-14 | **Task 13 features and stores.** `App.tsx` is boot only; `Shell` is 84 lines and composes `features/*`. Zustand vanilla stores (`settings`, `shell`, `files`, `editor`, `run`) built once by `createAppStores(bridge)` and provided by context; views read with `useStore`, actions via `getState`. Terminal OSC titles are sanitised and OSC 52 is swallowed; session helpers moved out of the component. `styles.css` split into 22 feature files. 57 web tests; D1 parity verified (files, editor, run `EXIT 0`, terminal, runtimes, rename, delete → trash). |
| 2026-11-14 | **Phase B/C review fixes, batches 1–3.** Batch 1 (`8889bac`): trash purge by embedded time, trash protected/hidden, killGroup/lazy-startup guards, safe envelope ids, SAF failure handling, safe New File/Save As, save records what it wrote. Batch 2 (`4b4e9a1`): no install timeout, 8 MB transport cap with an id on `E_LIMIT`, fixed/redacted runtime errors, strict envelope, `encodeDefaults`, reachable disconnect with stream failure and late-reply cancellation, guarded stream handlers. Batch 3 (`cad444a`): PTY write outside the lock, ordered replay, exited sessions kept for reattach, session/geometry caps, fd close, stdin EOF, coalesced proc output + truncation notice, count ordering, `stopSelf(startId)`, ack-after-render, resize-after-attach, fallback only on `E_NOT_FOUND`, jobs cancelled on finish/renderer loss. 130 Android tests, lint, 16 KB check, 71 web tests; D1 smoke (PTY, SAF cancel, foreground service). Report: `docs/reports/phase-b-c-fixes.md`; batches 4–6 stay open. |
| 2026-11-14 | **Phase B/C review, batches 4–6.** Batch 4 web (`640ac2d`): redaction on every message sink, benign-error/dedupe/re-entrancy/boot queue in global handlers, fire-and-forget reporting. Batch 4 Android (`4f6c7f8`): deferred background-safe renderer recovery with persisted loss time, full `configChanges`, side/cutout insets to CSS, wider `Redactor`, crash caps, default-port origin check. Batch 5 Android files (`4a72324`): non-regular read rejection, canonical `rel`, symlink entry delete/rename, POSIX permission preservation, strict UTF-8, 4 MB read, case-only rename. Batch 5/6 web (`2467948`): sheet stack + ordered back, run hide vs stop, run identity, file-list token, folder rename/delete tab state, CRLF, SAF saves, per-tab panes, session merge/dispose, storage permission flow, prompt validation, pane boundaries, snackbar/keyboard/settings/lazy-retry/MockBridge lows. Batch 6 partial (`56fc5bf`): `close_range` removed, SIGTERM grace, resize guard, precomputed fd bound, early `term.open` output, aligned replay. Gates: Android 194 tests + lint + 16 KB; web 183 tests, typecheck/lint/build. Device: both phones boot/PTY/service; D1 rotation; D2 font scale, 755→755 save, inline prompt error, storage permission grant + Downloads listing. Narrow items remain (W-06, L-06, L-08, L-15, L-24, S-15…S-20, B-14…B-16, W-25, W-30/31/33/38). |
| 2026-11-14 | **Phase D (Tasks 14–16) code complete.** Workspaces: `WorkspaceStore` registry + active root, `workspace.list` → `{ active, workspaces }`, top-bar switcher, SAF folder import, streaming zip export and strict zip restore with `saf.progress`. Editor: `fs.stat` + chunked `fs.read` + `writeChecked` (`E_CONFLICT`), 3 s draft autosave with recovery/discard, 5 s external-change poll with Reload / Keep mine, >1 MB read-only large-file mode, find/replace sheet. Search: `fs.search` streams `search.match`, ignore list, glob/case, capped and cancellable via `searchId`, results panel with jump-to-line. Tests: Android 252 (new workspace/draft/search/zip/hash suites), web 224 across 37 files (new mock Phase D, workspace, search and editor suites); typecheck, lint and build pass. Fixed `ReadReply.size` (`Long`), a lost buffered block in zip restore, closed-sheet accessibility leakage, and Keep mine opening the Save As prompt. Device rows stay pending: both phones unavailable. Report: `docs/reports/task14-16-verification.md`. |
| 2026-11-14 | **Phase D review.** 25 findings PD-01…PD-25 (2 High, 12 Medium, 11 Low) in `docs/reports/phase-d-analysis.md`. High: a corrupt `workspaces.json` silently resets the registry and is overwritten (other workspaces become unopenable), and `window.prompt`/`window.confirm` are no-ops in the unpatched Android WebView, which makes workspace create/rename/delete, backup-restore confirm and goto-line unreachable on device (SUSPECTED until D1/D2). Notable Mediums: Save As on a >1 MB read-only doc writes only the first chunk; stale search reply clobbers a newer search; import failure leaves a partial tree; failed SAF archive copies leak up to 512 MB in `cacheDir`; export aborts on one out-of-root symlink; `workspace.delete` never purges drafts (`Drafts.deleteWorkspace` dead code); Turkish-locale lowercasing breaks case-insensitive search; workspace switch leaves stale search results and kills session restore. Sound: restore zip-slip protection and caps, `expectedHash` conflict loop, draft hygiene, protected workspace roots, one-reply-per-request. Fix batches 1–3 are listed in the report; findings need tests + fixes before the Python phase starts. |
