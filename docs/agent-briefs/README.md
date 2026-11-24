# Agent briefs — Phase E (root mode) fixes

Work orders for a coding agent (agy). Each brief fixes items from
[`../REMAINING-WORK-PLAN.md`](../REMAINING-WORK-PLAN.md) §1 (R-01…R-10). The orchestrator writes the
briefs and reviews the result, the worker implements one brief per session, and the owner commits.

## Order

Run them **one at a time, in this order**. Each brief builds on the APIs of the one before it.

| Brief | Scope | Fixes | Depends on |
|---|---|---|---|
| [B1](B1-root-manager.md) | `RootManager` | R-01 timeouts, R-02 never prompt, R-08 su paths, root-pid wrapper helpers | — |
| [B2](B2-root-contract.md) | Bridge contract | R-05 `root.disable`, `root.lost` payload, generated types | B1 |
| [B3](B3-root-host-lifecycle.md) | Host process/PTY/reaper | R-03 loss detection + `root.lost`, R-04 kill the real root pid, R-06 root orphans, R-07 errors, R-05 host wiring | B1, B2 |
| [B4](B4-root-web.md) | Web | R-03/R-05 web halves, R-10 badge rule | B2 (B3 for the device test) |
| [B5](B5-root-extras.md) | Phantom-process option + docs | R-09, contract/ux docs | B4 |

## Rules for every brief (from `AGENTS.md`)

### Parallel mode (B2 + B3 together)

When the owner asks for briefs to run in parallel, the **parent session** works like this. The
parallel rules below override the "no commit / no branches" rule, for the parent only.

1. **Contract lock (parent, before any subagent starts).** It goes on local branch `phase-e-root`:
   - `Contract.kt`: `RootLostEvent(sessionId: String? = null, jobId: String? = null, reason: String = "revoked")`,
     with a KDoc saying `reason` is `"denied"` or `"revoked"`.
   - `RootHandler.kt`: **signature only**:
     `class RootHandler(private val rootManager: RootManager, private val json: Json = BridgeJson.value, private val onDisabled: () -> Unit = {}, private val log: (String) -> Unit = {})`.
   - `./gradlew generateBridgeTypes`, then `compileDebugKotlin`, then one local commit.
2. **Worktrees inside the repo**, so the reviewer can read them over the mount:
   `.worktrees/b2` (branch `phase-e-b2`) and `.worktrees/b3` (branch `phase-e-b3`), both from
   `phase-e-root`. Add `.worktrees/` to `.git/info/exclude`, then copy `android/local.properties`
   into each. If a worktree needs web tooling, symlink `web/node_modules`.
3. **Subagents** (at most 3) each work in **one** worktree, touch only their brief's files, and
   **never commit**. `Contract.kt`, `types.gen.ts` and `RootManager.kt` are frozen for them.
4. **One Gradle build at a time.** The laptop has little RAM, so every Gradle call is wrapped:
   `flock /tmp/leocode-gradle.lock ./gradlew --no-daemon …`.
5. **Merge (parent).** Check each worktree's diff against its brief. Commit each worktree on its
   branch, then `git merge --no-ff` both into `phase-e-root`. Run the full gates on the merge
   result and write `reports/B2-B3-merge.md`. **No push.** The reviewer checks `phase-e-root`
   before anything moves on.

- **Touch only the files listed in the brief.** If something outside scope must change, stop and
  write it under "Open questions" in the report. Don't edit it.
- **Do not commit, push, rebase or create branches.** Only the owner commits.
- Keep the existing style: Kotlin with JUnit4 JVM tests under `android/app/src/test/...`; web with
  Zustand vanilla stores and vitest. No new dependencies.
- **Line endings:** files are LF, UTF-8, no BOM. You are on Windows editing over an SSH mount, so
  make sure your editor does not convert to CRLF.
- Write a test first for every behaviour change, see it fail, then fix.
- Never weaken an existing test to make it pass. If one fails for a good reason, explain it.
- `targetSdk 28` is intentional (D-002). Don't "fix" the lint rule.

## Where things are

| | Path |
|---|---|
| Repo on the Linux laptop (build host) | `/home/sourav/Desktop/Apps/leocode` |
| Same repo as mounted on Windows | `\\sshfs.r\sourav@192.168.29.2\home\sourav\Desktop\Apps\leocode` |

**Default: the agent runs on the Linux laptop**, inside `/home/sourav/Desktop/Apps/leocode`. Build
tools, the Android SDK, `adb` and both phones are local there, so run the gate commands directly.
If `ANDROID_HOME` is missing: `export ANDROID_HOME=$HOME/Android/Sdk`.

*Fallback (agent on Windows):* edit through the mount and run commands over SSH with a login shell:

```bash
ssh sourav@192.168.29.2 'bash -lc "cd ~/Desktop/Apps/leocode/android && ./gradlew --no-daemon testDebugUnitTest --tests dev.leocode.core.RootManagerTest 2>&1 | tail -40"'
```

**Devices** (only when a brief asks for it, or the owner runs plan §2): D1 Redmi Note 7S, Android
9, unrooted (serial `11f98015`, or Wi-Fi ADB). D2 POCO F1, Android 15, Magisk-rooted (serial
`e76846f`). Check with `adb devices -l`. Read-only checks are fine; never `pm clear` or uninstall
without being told to.

**Before starting a brief:** run `git status --short` and record it in the report, so the review
can tell your changes apart from what was already uncommitted.

## Gates

Run the gates for every side you touched before you report:

```bash
# Android (from android/)
./gradlew --no-daemon testDebugUnitTest lintDebug
./gradlew --no-daemon generateBridgeTypes && git status --porcelain -- ../web/src/bridge/types.gen.ts
# (only when Contract.kt / BridgeTypesGenerator.kt changed; the new types.gen.ts must be included)

# Web (from web/)
npm run typecheck && npm run lint && npm test && npm run build
```

Phone tests are **not** part of a brief. The owner runs them after all the briefs (plan §2).

## Report

Finish every brief by writing `docs/agent-briefs/reports/<brief-id>.md`:

```markdown
# <brief-id> report
## Summary            — 3–6 lines: what changed and why
## Files changed      — every file, one line each (added / modified)
## Tests added        — test names, and what each proves
## Gates              — each command you ran + its last ~15 lines of output (PASS/FAIL counts)
## Deviations         — anything done differently from the brief, and why
## Open questions     — out-of-scope problems found, decisions needed
```

The report is reviewed against the code. "Done" without gate output counts as not done.
