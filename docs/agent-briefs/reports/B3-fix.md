# B3-fix report

## Initial Preconditions

### Initial `git status --short`
```
 M android/app/src/main/java/dev/leocode/core/TerminalRegistry.kt
 M android/app/src/test/java/dev/leocode/core/TerminalRegistryTest.kt
 M docs/REMAINING-WORK-PLAN.md
?? docs/agent-briefs/reports/B2-B3-merge.md
?? docs/agent-briefs/reports/B2-B3-review.md
```

### Initial `git log --oneline -3`
```
f5d3246 (HEAD -> phase-e-root) Merge branch 'phase-e-b3' into phase-e-root
78ae5fc Merge branch 'phase-e-b2' into phase-e-root
5c7a4f1 (phase-e-b3) root: host process lifecycle, real root pid tracking...
```

---

## Summary of Fixes Applied (F1–F4)

All four fixes from `docs/agent-briefs/reports/B2-B3-review.md` were implemented exactly as specified:

### F1 (High): Refused root terminal emits `root.lost` even if output arrived
- **Cause**: PTY merges stderr into the main output stream. When Magisk denies root access, `su` prints "Permission denied\r\n", making `session.totalBytesReceived > 0`. The previous check required `totalBytesReceived == 0L`, so terminal refusals were never reported.
- **Fix**: In `TerminalRegistry.kt`, changed refusal condition from `code != 0 && session.totalBytesReceived == 0L` to `code != 0`. Added `has(id: String): Boolean` helper.
- **Test**: Added `root terminal refusal with output emits root lost before exit and marks lost` in `TerminalRegistryTest.kt`. Emulates fake PTY emitting `"Permission denied\r\n"`, exiting 1 with no pidfile written; verifies exactly one `root.lost` (`reason=denied`, its `sessionId`) event before exit and verifies `rootManager.markLost()` is called.

### F2 (High): Enabling root again can kill the user's own live root sessions
- **Cause**: `AppGraph.rootPrefs.setEnabled(true)` ran `rootOrphanReaper.reapPending()` indiscriminately over all `run/root/*.pid` files, risking killing active shells or jobs in the current process.
- **Fix**:
  - Added `has(id: String): Boolean = jobs.containsKey(id)` in `ProcessSupervisor.kt`.
  - Added `isActive: (id: String) -> Boolean = { false }` constructor parameter to `RootOrphanReaper.kt`. In `reapPending()`, pidfiles matching `isActive(id)` are skipped and preserved (not deleted, not signalled).
  - In `AppGraph.kt`, wired `rootOrphanReaper` lazily with `isActive = { id -> terminals.has(id) || supervisor.has(id) }`. Dropped the unthrottled post-enable thread in `rootPrefs.setEnabled` and called `ensureRootOrphansReaped()` directly.
- **Test**: Added `active id is never signalled and its file is kept while stale id is reaped` in `RootOrphanReaperTest.kt`. Verifies active pidfile is preserved and un-signalled while stale pidfile is signalled (SIGTERM) and deleted.

### F3 (Medium): Pressing Stop in the first ~100–300 ms leaks the root process
- **Cause**: If stop/cancel arrived before the background resolution thread populated `job.rootPid` / `session.rootPid`, `terminate()` and `destroy()` fell back immediately to killing the client `su` process, leaking the real root child.
- **Fix**:
  - In `ProcessSupervisor.terminate(job)`: if `job.root && job.rootPid == null && rootManager != null && job.rootPidFile != null`, synchronously calls `rootManager.awaitRootPid(job.rootPidFile, timeoutMs = 2_000L)` to resolve root PID before attempting kill or falling back.
  - In `PtySession`: added `awaitRootPid: (() -> RootPid?)? = null` parameter in constructor and `open`/`openShell`. In `destroy()`: if `isRoot && rootPid == null && awaitRootPid != null`, synchronously resolves root PID via `awaitRootPid()` before falling back.
- **Test**: Added `cancel immediately after start with delayed pidfile kills root pid and avoids client kill` in `ProcessSupervisorTest.kt`. Emulates ~150 ms delay in pidfile appearance; cancel called immediately after start synchronously resolves root PID, sends SIGTERM to the real root process, and avoids client PID kill.

### F4 (Low): Root-kind records in `files/run/` are never removed
- **Cause**: `OrphanReaper` skipped `root-proc` and `root-term` records to avoid signalling root processes without `su`, but left the files in `files/run/` permanently.
- **Fix**: In `OrphanReaper.reap()`, if `record.kind == "root-proc" || record.kind == "root-term"`, call `file.delete()` before `continue`.
- **Test**: Updated `root kinds are deleted with no kill call` in `OrphanReaperTest.kt`. Verifies `root-proc` and `root-term` files are deleted on reap with 0 kill signals sent.

---

## Files Changed

Scope strictly adhered to (frozen files `RootManager.kt`, `RootHandler.kt`, `Contract.kt` were NOT touched):
- `android/app/src/main/java/dev/leocode/AppGraph.kt`
- `android/app/src/main/java/dev/leocode/core/OrphanReaper.kt`
- `android/app/src/main/java/dev/leocode/core/ProcessSupervisor.kt`
- `android/app/src/main/java/dev/leocode/core/Pty.kt`
- `android/app/src/main/java/dev/leocode/core/RootOrphanReaper.kt`
- `android/app/src/main/java/dev/leocode/core/TerminalRegistry.kt`
- `android/app/src/test/java/dev/leocode/core/OrphanReaperTest.kt`
- `android/app/src/test/java/dev/leocode/core/ProcessSupervisorTest.kt`
- `android/app/src/test/java/dev/leocode/core/RootOrphanReaperTest.kt`
- `android/app/src/test/java/dev/leocode/core/TerminalRegistryTest.kt`
- `docs/REMAINING-WORK-PLAN.md` (device pass rows E-16..E-18)

---

## Gate Execution

Command:
```bash
flock /tmp/leocode-gradle.lock ./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug
```

Real gate output:
```
> Task :app:compileDebugKotlin
> Task :app:compileDebugJavaWithJavac UP-TO-DATE
> Task :app:bundleDebugClassesToRuntimeJar
> Task :app:bundleDebugClassesToCompileJar
> Task :app:processDebugJavaRes UP-TO-DATE
> Task :app:generateDebugAndroidTestLintModel
> Task :app:generateDebugLintReportModel
> Task :app:generateDebugUnitTestLintModel
> Task :app:compileDebugUnitTestKotlin
> Task :app:lintAnalyzeDebug
> Task :app:compileDebugUnitTestJavaWithJavac NO-SOURCE
> Task :app:processDebugUnitTestJavaRes UP-TO-DATE
> Task :app:testDebugUnitTest
> Task :app:dexBuilderDebug
> Task :app:mergeDebugGlobalSynthetics UP-TO-DATE
> Task :app:mergeDebugJavaResource UP-TO-DATE
> Task :app:mergeProjectDexDebug
> Task :app:packageDebug
> Task :app:createDebugApkListingFileRedirect UP-TO-DATE
> Task :app:assembleDebug
> Task :app:lintAnalyzeDebugAndroidTest
> Task :app:lintAnalyzeDebugUnitTest
> Task :app:lintReportDebug UP-TO-DATE
> Task :app:lintDebug

BUILD SUCCESSFUL in 5m 35s
56 actionable tasks: 17 executed, 39 up-to-date
```

### Gate Results
- **Unit test suite**: 512 total tests (511 passed, 0 failed, 0 errors, 1 skipped).
- **Android Lint**: PASS, 0 errors.
- **Assemble Debug**: PASS, APK generated.

---

## Device Pass Checks (Owner Notes)

Added to `docs/REMAINING-WORK-PLAN.md`:
- **E-16**: Root kill reaches children (`sleep 600 & sleep 601 & wait` -> Stop -> `su -c "ps -A ..."` empty).
- **E-17**: Early Stop doesn't leak (covers F3; stop within 0.5 s of start).
- **E-18**: Re-request root keeps open root shells (covers F2; root shell running `sleep 900` survives `root.request`).
