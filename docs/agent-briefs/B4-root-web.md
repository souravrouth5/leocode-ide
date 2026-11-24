# B4 — Root mode in the web app: real disable, loss banners, badge rule

Read [`README.md`](README.md) first. **B2 must be merged** (it adds `root.disable` and the new
`RootLostEvent` type to `web/src/bridge/types.gen.ts`). B3 is needed for the device test, not for
this code.

## Context

- `web/src/features/root/rootStore.ts`: `disableRoot()` only sets local state. `onRootLost` sets
  `{granted:false, enabled:false}`, which hides the "Try again" path, because the host keeps
  `enabled` after a loss (B1 `markLost`).
- `web/src/features/layout/AppDialogs.tsx` passes `onDisableRoot={() => stores.root.getState().disableRoot()}`
  to Settings.
- `web/src/bridge/android.ts` already forwards `root.lost` events to listeners;
  `web/src/bridge/mock.ts` has `rootStatus/rootRequest/onRootLost`.
- `TerminalPane.tsx` has `isRootSession` + "Root Shell" / "Exit Root Shell";
  `RunSheet.tsx` has `RunRootControls`.
- **R-10.** Plan §8: the ROOT badge shows on root terminal tabs, the run sheet and the status bar
  **while any root process is alive**. Today the header badge follows `enabled`.

## Files you may touch

- `web/src/bridge/types.ts`, `web/src/bridge/android.ts`, `web/src/bridge/mock.ts`
- `web/src/features/root/rootStore.ts`, `rootStore.test.ts`, `RootWarningDialog.tsx`
- `web/src/features/layout/AppDialogs.tsx`
- `web/src/features/terminal/TerminalPane.tsx` (root bits only)
- `web/src/features/run/RunSheet.tsx`, `web/src/features/run/runStore.ts` (root bits only)
- `web/src/errors/catalog.ts` (root entries only)
- The header/status-bar component that renders `# ROOT` (find it with `grep -rn "# ROOT" web/src`)
- Tests next to the files above, plus `web/src/bridge/mock*.test.ts` if mock parity tests exist

Not `types.gen.ts` (generated) and not `SettingsDialog.tsx` (B5).

## Changes

1. **Bridge:** add `rootDisable(options?): Promise<RootStatus>` to the `Bridge` interface,
   `android.ts` (`root.disable`, Fast timeout class, like `root.status`) and `mock.ts`. The mock
   clears enabled/granted and ends mock root sessions. Use the generated `RootLostEvent` type
   (`sessionId?`, `jobId?`, `reason`).
2. **rootStore**
   - `disableRoot` becomes async: calls `bridge.rootDisable()` and sets state from the reply. On
     error, keep the previous state and rethrow so the existing error routing shows it.
   - `onRootLost(event)`: `granted:false`, **keep `enabled` as the host reports it**, and keep
     `lastLost: { reason, at }` for the UI.
   - New `liveRootCount: number` with `rootProcessStarted()` / `rootProcessEnded()`, fed by the
     terminal and run code. Simpler alternative: derive it from existing session/job state, if that
     state is reliable.
   - After `requestRoot` succeeds, call `checkStatus()` so the store matches the host.
3. **Loss UX**
   - A `root.lost` whose `sessionId` is the current root terminal: mark that tab ended. Show an
     inline banner: "Root access was refused. The root session ended." with **Try again**
     (`requestRoot`) and **Open normal shell**.
   - A `root.lost` whose `jobId` is the current run: an inline banner in the run sheet with **Try
     again**.
   - `E_ROOT_DENIED` in `catalog.ts`: keep the Sheet surface, make the primary action "Try again" →
     `requestRoot`. `E_ROOT_UNAVAILABLE` stays inline in Settings.
4. **R-10 badge rule** (also goes into `docs/ux-spec.md` in B5)
   - Header: small `ROOT MODE` chip while root mode is enabled (today's behaviour, renamed so it
     isn't confused with a live root process).
   - Terminal tab/status, run sheet and status bar: the red `# ROOT` badge **only while a root
     process is alive** (`liveRootCount > 0`, or that tab/job is root and alive).
5. **AppDialogs:** `onDisableRoot` awaits `disableRoot()`. While the call is in flight, the toggle is
   disabled.

## Tests (vitest)

- rootStore: `disableRoot` calls `bridge.rootDisable` once and applies the reply; a rejection keeps
  the old state and rethrows; `onRootLost` keeps `enabled`, clears `granted` and sets `lastLost`;
  `requestRoot` success triggers `checkStatus`.
- Mock bridge: `rootDisable` → `rootStatus().enabled === false`; root `term.open` after disable
  rejects with `E_ROOT_DENIED`.
- TerminalPane (or its helper): a `root.lost` for its session shows the banner and marks the tab
  ended; one for another session id does nothing.
- RunSheet: a `root.lost` for the active job shows the banner.
- Badge: header chip follows `enabled`; `# ROOT` is visible only while `liveRootCount > 0`.
- The existing a11y audit test (`web/src/features/a11y/a11yAudit.test.tsx`) still passes: 48 dp
  targets and labels on any new buttons.

## Gate

```bash
cd web && npm run typecheck && npm run lint && npm test && npm run build
cd .. && bash scripts/sync-web.sh     # copies the bundle into the APK assets; mention it in the report
```

Report to `docs/agent-briefs/reports/B4.md`.
