# B1-fix report

## Initial `git status --short`
```
 M android/app/src/main/java/dev/leocode/core/RootManager.kt
 M android/app/src/test/java/dev/leocode/core/RootManagerTest.kt
 M docs/REMAINING-WORK-PLAN.md
 M docs/agent-briefs/B2-root-contract.md
 M docs/agent-briefs/B3-root-host-lifecycle.md
?? docs/agent-briefs/reports/
```

## Summary
Applied fixes F1 and F2 from `docs/agent-briefs/reports/B1-review.md`:
- **F1**: Updated `RootManager.isRootPidAlive` to use a single `su` invocation (`su -c "kill -0 <pid> 2>/dev/null && cut -d' ' -f22 /proc/<pid>/stat"`) instead of separate `kill -0` and `cat` calls. This avoids double Magisk toasts/logging overhead.
- **F2**: Added `chmod 0644 $quotedPidFile` directly following the pidfile write in `buildRootCommand` and `buildRootShell`. This ensures the root pidfile is readable by the unprivileged app user regardless of the root shell's umask.
- Updated unit tests in `RootManagerTest.kt` to verify exact single-command invocation for `isRootPidAlive` and the updated command strings with `chmod 0644`.

## Files changed
- `android/app/src/main/java/dev/leocode/core/RootManager.kt` (modified)
- `android/app/src/test/java/dev/leocode/core/RootManagerTest.kt` (modified)

## Tests updated
- `buildRootCommand and buildRootShell construct expected commands with quoting`: Updated exact-string assertions to expect `chmod 0644 '<pid>'` after the echo redirection.
- `isRootPidAlive verifies process existence and start time matching`: Updated to assert exactly one `su` command execution per call (`kill -0 <pid> 2>/dev/null && cut -d' ' -f22 /proc/<pid>/stat`), while maintaining test coverage for alive matching, dead process, recycled pid, and `canUseRoot == false`.

## Gate
Command run:
```bash
./gradlew --no-daemon testDebugUnitTest --tests 'dev.leocode.core.RootManagerTest' lintDebug
```

Gate output:
```
> Task :app:compileDebugUnitTestJavaWithJavac NO-SOURCE
> Task :app:processDebugUnitTestJavaRes UP-TO-DATE
> Task :app:testDebugUnitTest
> Task :app:lintAnalyzeDebugAndroidTest
> Task :app:lintAnalyzeDebugUnitTest
> Task :app:lintReportDebug UP-TO-DATE
> Task :app:lintDebug

BUILD SUCCESSFUL in 4m 47s
34 actionable tasks: 12 executed, 22 up-to-date
```
Test results: 17 completed, 0 failed, 0 skipped.
Android Lint results: PASS, 0 errors.

## Deviations
None.

## Open questions
None for B1. As noted in the review, `RootHandlerTest` fails in the full test suite due to unmocked `android.util.Log.i`, which is scoped for B2.
