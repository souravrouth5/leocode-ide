# B2-B3 Merge Report

## 0. Preconditions Check
At the start of the parallel run on `feat/phase-g`:
```
$ git status --short
 M docs/agent-briefs/README.md

$ git log --oneline -3
41a051a (HEAD -> feat/phase-g) root: enforce su timeouts, never prompt from root.status, root-pid helpers (B1, R-01/R-02/R-08)
e3f52c4 docs: Phase E remaining-work plan and agent briefs B1–B5
9325da8 (origin/feat/phase-g) WIP: root device work plan
```
Precondition satisfied: B1 commit (`41a051a`) is present in history.

## 1. Contract Lock
Branch `phase-e-root` created from `feat/phase-g`.
Contract locked:
- `Contract.kt`: Updated `RootLostEvent` to `RootLostEvent(sessionId: String? = null, jobId: String? = null, reason: String = "revoked")` with KDoc documenting `"denied"` and `"revoked"`.
- `RootHandler.kt`: Updated constructor signature to `class RootHandler(private val rootManager: RootManager, private val json: Json = BridgeJson.value, private val onDisabled: () -> Unit = {}, private val log: (String) -> Unit = {})`.
- Generated bridge types: `generateBridgeTypes` verified and compiled via `compileDebugKotlin`.
- Commit: `4c2647f` ("root: lock Phase E contract (RootLostEvent fields, RootHandler hooks)").

## 2. Worktrees and Subagents
Two isolated worktrees created inside `.worktrees/`:
- `.worktrees/b2` on branch `phase-e-b2`
- `.worktrees/b3` on branch `phase-e-b3`
Both configured with `.git/info/exclude`, local `android/local.properties`, and `web/node_modules` symlink.

Two subagents ran in parallel:
- **Subagent B2** (`ac8d8661...`): Implemented B2 (`RootHandler` unmocked Log fix, `root.disable`, deduplicated `root.status` logging, bridge contract docs, `RootHandlerTest`).
- **Subagent B3** (`af1b1eb6...`): Implemented B3 (Real root PID tracking in `ProcessSupervisor` / `PtySession`, `root.lost` emission on refusal, `closeRoot` / `cancelRoot` host disable wiring, lazy `RootOrphanReaper`, tests).

## 3. Commits and Merges
Both worktrees committed on their respective branches:
- `phase-e-b2`: `95a4994` ("root: bridge contract, root.disable, status deduplication (B2, R-05)")
- `phase-e-b3`: `5c7a4f1` ("root: host process lifecycle, real root pid tracking, refusal detection, orphan reaper (B3, R-03/R-04/R-06/R-07)")

Both branches merged into `phase-e-root` using `git merge --no-ff`:
- Merge `phase-e-b2`: `78ae5fc` (clean, 0 conflicts)
- Merge `phase-e-b3`: `f5d3246` (clean, 0 conflicts)

Merge conflicts: **None**. The file scopes were strictly disjoint.

## 4. Full Merge Gate Outputs

### Web Gate
Command:
```bash
cd web && npm run typecheck && npm test
```
Output:
```
> leocode-web@0.0.1 typecheck
> tsc --noEmit

> leocode-web@0.0.1 test
> vitest run

Test Files  56 passed (56)
     Tests  463 passed (463)
  Duration  64.27s
```
Result: **PASS** (0 type errors, 463/463 tests passed).

### Android Gate
Command:
```bash
cd android && flock /tmp/leocode-gradle.lock ./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug
```
Output:
```
> Task :app:compileDebugUnitTestJavaWithJavac NO-SOURCE
> Task :app:processDebugUnitTestJavaRes UP-TO-DATE
> Task :app:testDebugUnitTest
> Task :app:dexBuilderDebug
> Task :app:mergeDebugGlobalSynthetics UP-TO-DATE
> Task :app:mergeDebugJavaResource UP-TO-DATE
> Task :app:mergeProjectDexDebug
> Task :app:lintAnalyzeDebugAndroidTest
> Task :app:packageDebug
> Task :app:createDebugApkListingFileRedirect UP-TO-DATE
> Task :app:assembleDebug
> Task :app:lintAnalyzeDebugUnitTest
> Task :app:lintReportDebug UP-TO-DATE
> Task :app:lintDebug

BUILD SUCCESSFUL in 6m 39s
56 actionable tasks: 18 executed, 1 from cache, 37 up-to-date
```
Test results across all suites:
- **Total unit tests**: 509 passed, 0 failed, 1 skipped.
- **Android Lint (`lintDebug`)**: PASS (0 errors).
- **Debug APK (`assembleDebug`)**: BUILD SUCCESSFUL (`app-debug.apk` built).

## 5. Device Checks Required (Owner Action on D2)
As documented in B3:
1. Root `sleep 600` via Run as root -> Stop -> verify `su -c "ps -A -o PID,PGID,USER,NAME | grep sleep"` is empty.
2. Root shell running `sleep 600` -> Exit Root Shell -> verify process is terminated.
3. Deny in Magisk -> open new root shell -> verify `root.lost` emitted with `reason="denied"`.
