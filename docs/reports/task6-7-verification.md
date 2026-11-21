# Tasks 6 and 7 verification

**Date:** 2026-11-11 · **Branch:** `v9-impl` · **Plan:** [v9 §15](../LeoCode_Implementation_Plan_v9.md) Tasks 6 and 7

## Status at a glance

| Check | Result | Evidence |
|---|---|---|
| Android unit tests (`testDebugUnitTest`) | **PASS**, 88 tests, 0 failures | Gradle XML results, this run |
| Android lint (`lintDebug`, blocking) | **PASS** | this run |
| Debug APK builds (`assembleDebug`) | **PASS** | this run |
| 16 KB ELF check (`check-elf-alignment.sh`) | **PASS**, 2 ELF files (`libleocodepty.so`, `python3-launcher`) | this run |
| Web typecheck / lint / test / build | **PASS**, 6 web tests | this run |
| Web bundle in APK assets matches `web/dist` | **PASS** | `scripts/sync-web.sh` + `diff -rq` |
| Type-drift demo (rename a DTO field) | **PASS**, typecheck breaks until web code is updated, reverted cleanly | §3 |
| CI drift step (`types.gen.ts` regenerated and compared) | **PASS** on GitHub, run [44884113986](https://github.com/souravrouth5/leocode-ide/actions/runs/44884113986) | §4 |
| Device re-run of harness T1–T7, S1 on D1 and D2 | **PASS** 2026-11-21, T1–T9 + S1 (§5) | [`20261121-135916-phaseB-rerun-D1-11f98015.txt`](../device-reports/20261121-135916-phaseB-rerun-D1-11f98015.txt), D2 log |
| `yes` / Stop all demo on D1 and D2 | **PASS** 2026-11-21 (§5) | [`20261121-task6-yes-stop-D1-D2.txt`](../device-reports/20261121-task6-yes-stop-D1-D2.txt) |

## 1. Task 6 changes in this pass

- `ProcessHost` (the old synchronous process runner) is deleted. The only user was the debug harness.
- The harness (`android/app/src/debug/.../HarnessActivity.kt`) now runs its T1, T2, T4, T5, T7 and S1 tests through `HarnessProcess`, a debug-only blocking adapter over `ProcessSupervisor`.
- T3 (group kill) now uses `ProcessSupervisor.start` and `cancel`. This is the production stop path: SIGTERM to the group, 2 s, then SIGKILL. The test checks that the group is gone afterwards.
- The harness closes the supervisor in `onDestroy`.

Result: the debug harness and the production bridge use the same process code. The bridge already did, so there is one process path left.

Remaining Task 6 deviation: `core/RuntimeInstaller.kt` (prototype, Phase G) still has its own `runProcess` and builds its own environment instead of going through `ChildEnv`. It is replaced in Task 25; tracked in the Phase A report (P-07, P-09).

## 2. Task 7 changes in this pass

- The generator now emits `ERROR_CODES` as a runtime `as const` list, `ErrorCode` derived from it, and `isErrorCode(value)` as a type guard.
- `BridgeError.code` is typed `ErrorCode`, not `string`.
- `android.ts` checks every incoming error code with `isErrorCode` and maps unknown codes to `E_INTERNAL`. An unknown code means the host and web contracts disagree, so it is not shown as a user error.
- `BridgeTypesCoverageTest` (Kotlin) fails if a `@Serializable` DTO in `Contract.kt` is missing from the generated file, or an `ErrorCode` is missing from `ERROR_CODES`.
- `generated.test.ts` (web) checks that `ERROR_CODES` has no duplicates and that `isErrorCode` accepts only generated codes.
- `ci.yml` (android job) regenerates the file and fails if `git status` shows `web/src/bridge/types.gen.ts` as modified or untracked.

## 3. Type-drift demo (run on this branch)

Change: `FileEntry.mtime` in `Contract.kt` gets `@SerialName("modifiedAt")`. This changes the wire name and so the generated type.

```
== CI drift check would report:
 M web/src/bridge/types.gen.ts          <- stale generated file: CI step fails
89:  modifiedAt: number

== typecheck after regeneration:
src/bridge/mock.ts(123,9): error TS2353: 'mtime' does not exist in type 'FileEntry'.
src/components/FileTree.tsx(220,21): error TS2339: Property 'mtime' does not exist on type 'FileEntry'.
src/components/FileTree.tsx(220,38): error TS2339: Property 'mtime' does not exist on type 'FileEntry'.
src/components/FileTree.tsx(565,34): error TS2339: Property 'mtime' does not exist on type 'FileEntry'.
src/components/FileTree.tsx(565,65): error TS2339: Property 'mtime' does not exist on type 'FileEntry'.

== after `git checkout` of Contract.kt and regeneration:
typecheck PASS after revert
```

The experiment was reverted in full; the tree contains no `modifiedAt`.

## 4. CI drift step

Added to `.github/workflows/ci.yml`, android job, after the unit tests:

```yaml
- name: Generated bridge types are up to date (Task 7 drift check)
  working-directory: android
  run: |
    ./gradlew --no-daemon generateBridgeTypes
    if [ -n "$(git status --porcelain -- ../web/src/bridge/types.gen.ts)" ]; then
      ...exit 1
```

Not verified on GitHub. Verification that the step passes: once the branch is pushed, the next run must show it green. Locally, after the regenerated file is committed, `git status --porcelain` for that path is empty (checked in §6 after commit).

## 5. Device runs: PASS (2026-11-21)

Both phones ran the current APK (versionCode 2, targetSdk 28).

1. Harness rows, run one id at a time (`--es run T1` … `T9`, `S1`) on D1 and D2.
   T1–T9 and S1 all pass on both; the Phase F network rows were not part of this
   run. Raw logs:
   [`20261121-135916-phaseB-rerun-D1-11f98015.txt`](../device-reports/20261121-135916-phaseB-rerun-D1-11f98015.txt)
   and the matching `-D2-192_168_29_85_39941` file.
2. Task 6 demo on both phones: `yes` in the terminal keeps the UI responsive
   (three CDP round-trips in 0.20–0.26 s while the flood ran), Stop all leaves
   only the app process (`ps` filtered by uid), and Restart gives a working shell.
   Evidence: [`20261121-task6-yes-stop-D1-D2.txt`](../device-reports/20261121-task6-yes-stop-D1-D2.txt).

The demo exposed a stale-state bug: Stop all killed the PTY but an attached page
kept showing `pty`, because `TerminalRegistry.closeAll()` dropped the listener
without an exit event. `Session.close(notifyExit = true)` now delivers
`Listener.exit(143)` before `pty.destroy()`; the page shows `exited 143` and the
Restart button. Covered by `TerminalRegistryTest."closeAll reports an exit to an
attached listener"`. `term.close` (the page disposing its own session) still
closes silently.

Still outstanding: `RuntimeInstaller` keeps its own process launcher and
environment until Task 25 (P-07/P-09 in the Phase A report).

## 6. Environment note

The sandbox mounted `~/.gradle` read-only and has no internet access. To run Gradle, the Gradle home was copied to `/home/sourav/Desktop/Apps/.gradle-home` (outside the repo, about 1.4 GB) and used as `GRADLE_USER_HOME`. Delete that folder when it is no longer needed.
