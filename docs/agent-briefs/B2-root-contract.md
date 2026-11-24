# B2 — Root contract: `root.disable`, `root.lost` payload, generated types

Read [`README.md`](README.md) first. **B1 must be merged before you start.** This brief relies on
`RootManager.status()` making no shell calls.

## Context

- **R-05.** Turning root mode off is web-only today: `web/src/features/root/rootStore.ts`
  `disableRoot()` sets `enabled:false` locally, and no bridge method clears the host preference. The
  host stays enabled, `proc.run {root:true}` / `term.open {root:true}` are still accepted, and root
  mode comes back after a relaunch.
- **`root.lost`.** `Contract.kt` has `RootLostEvent(sessionId: String? = null)` and the web listens
  for it, but nothing emits it (B3 adds the emitters). B3 and B4 need one shared payload first.
- Lock the contract before host and web build against it, the same way Phase F did (`c69ff45`).

## Files you may touch

- `android/app/src/main/java/dev/leocode/bridge/Contract.kt` (root section only)
- `android/app/src/main/java/dev/leocode/bridge/RootHandler.kt`
- `android/app/src/main/java/dev/leocode/bridge/BridgeTypesGenerator.kt` (seed list)
- `android/app/src/test/java/dev/leocode/bridge/RootHandlerTest.kt`
- `android/app/src/test/.../BridgeTypesCoverageTest.kt`, only if it needs the new DTO listed
- `web/src/bridge/types.gen.ts`, **generated only** (`./gradlew generateBridgeTypes`, never edited by hand)
- `docs/bridge-contract.md` (root rows, events table, timeout table)

Do not touch `AppGraph.kt` (B3 wires the hook) or any other web file (B4).

## Changes

1. **Contract.kt**
   - `RootLostEvent(sessionId: String? = null, jobId: String? = null, reason: String = "revoked")`.
     `reason` is `"denied"` (su refused a new root operation) or `"revoked"` (the grant disappeared).
     Document the two values in a KDoc.
   - No request DTO is needed for `root.disable` (`{}`); it replies with `RootStatusReply`.
2. **RootHandler.kt**
   - **Fix the red suite first (found in the B1 review).** `RootHandlerTest` fails 3/3 with
     `Method i in android.util.Log not mocked` because `RootHandler` calls `android.util.Log.i`
     directly. Remove the direct `Log` calls and inject `private val log: (String) -> Unit = {}`
     the way `RuntimeHandler`/`PythonHandler` do. `AppGraph` keeps passing a real logger (B3
     wires it; until then the default no-op is fine). Do **not** enable
     `unitTests.isReturnDefaultValues`.
   - Constructor gains `private val onDisabled: () -> Unit = {}`.
   - `METHODS` += `"root.disable"`.
   - `root.disable` → `rootManager.setEnabled(false)`, then `runCatching { onDisabled() }` (a
     failing hook must not fail the reply, so log it), then reply with the fresh `status()`.
     Idempotent. Never runs `su`.
   - `root.request` unchanged.
   - Log `root.status` only when the state changes from the last reply, not on every poll.
3. **Generated types.** Add any new descriptor to `BridgeTypesGenerator.kt` and run
   `./gradlew generateBridgeTypes`. The regenerated `web/src/bridge/types.gen.ts` is part of your
   change, and web `npm run typecheck` must still pass with it.
4. **docs/bridge-contract.md**
   - `root.status`, `root.request`: "planned (Task 17)" → "live (Task 17)".
   - Add a row: `root.disable` | `{}` → `{ available, granted, enabled }` | live (Task 17) |
     "Clears the preference, ends root sessions and jobs, never prompts".
   - Timeout table: `root.disable` is Fast (10 s).
   - Events table: `root.lost` | `{ sessionId?, jobId?, reason }` | "Sent on the stream of the root
     terminal session or root job it concerns, when `su` refuses a new root operation (`denied`) or
     the grant is gone (`revoked`). A root shell that is already running keeps uid 0 after a
     revoke in Magisk; the loss shows up on the next root operation."

## Tests (RootHandlerTest)

- `root.disable` with prefs enabled → prefs disabled, `onDisabled` called once, reply
  `enabled=false, granted=false`, and the fake shell runner recorded **no** commands.
- `root.disable` twice → still OK, `onDisabled` called twice (harmless), no exception.
- `onDisabled` throws → the reply still succeeds.
- `root.status` with prefs enabled → no shell commands (relies on B1).
- Unknown method still raises `E_UNKNOWN_METHOD`.

## Gate

```bash
./gradlew --no-daemon testDebugUnitTest lintDebug    # FULL suite must be 0 failures
./gradlew --no-daemon generateBridgeTypes && git -C .. diff --stat -- web/src/bridge/types.gen.ts
cd ../web && npm run typecheck
```

Report to `docs/agent-briefs/reports/B2.md`. Include the `types.gen.ts` diff stat.
