# B5 — Phantom-process option (R-09) and root docs

Read [`README.md`](README.md) first. **B4 must be merged.**

## Context

- Plan §8 / Task 10: on rooted phones LeoCode should **offer** to run
  `device_config put activity_manager max_phantom_processes 2147483647` (Android 12+), with an
  explanation, never silently. Today `web/src/components/SettingsDialog.tsx` (around line 500) only
  prints the command. `docs/test-matrix.md` row "Root option: `max_phantom_processes` applied" is
  pending.
- Several docs describe root mode in ways the code doesn't match (su paths, badge rule, loss
  behaviour).

## Files you may touch

- `web/src/components/SettingsDialog.tsx` (the background/phantom section only) + its test
- A small helper, e.g. `web/src/features/root/phantom.ts` + test
- `docs/ux-spec.md` (root mode section)
- `docs/HANDOFF.md`: the su path list and the "What to do next" section only
- `docs/test-matrix.md`: the root-mode **row wording** only (not results)

## Changes

1. **Phantom option (R-09)**
   - Show an **"Apply until reboot"** button under the existing text, and only when: Android ≥ 12
     (SDK from `app.info`/diagnostics; hide the button if unknown), root mode enabled, and the store
     not in a lost state.
   - Tap → confirm dialog: "Raises Android's background child-process limit until the next reboot.
     LeoCode runs this as root: `device_config put activity_manager max_phantom_processes
     2147483647`." Buttons: Apply / Cancel.
   - Apply → `proc.run { argv: ["/system/bin/sh","-c","device_config put activity_manager
     max_phantom_processes 2147483647 && device_config get activity_manager max_phantom_processes"],
     root: true, timeoutMs: 15000 }`. Show success with the value read back, or the error through the
     normal error routing.
   - Never run automatically, and don't persist "applied" (it resets on reboot).
2. **docs/ux-spec.md, root section.** Write down the R-10 badge rule from B4, the loss behaviour ("a
   running root shell keeps uid 0 after a revoke; the next root operation fails with
   `E_ROOT_DENIED` and a `root.lost` banner"), and the phantom option.
3. **docs/HANDOFF.md.** Fix the su path list to match `RootManager.DEFAULT_SU_PATHS` (no
   `/data/adb/ksu/bin/su`; say only Magisk is tested). Replace "What to do next" with a pointer to
   `docs/REMAINING-WORK-PLAN.md` §5.
4. **docs/test-matrix.md, root-mode table row text only:**
   - "Grant revoked in root manager mid-session → session ends + banner" becomes "Grant revoked →
     next root shell / Run as root fails with `E_ROOT_DENIED` + `root.lost` banner; running root
     shell unaffected (documented)".
   - Add rows: "Disable persists across relaunch", "`root.status`/Diagnostics never prompt",
     "Root orphan reaped on next root use after a force-stop".

## Tests

- Phantom helper/Settings: the button is hidden when root is disabled, SDK < 31 or unknown; Apply
  sends exactly the argv above with `root: true`; Cancel sends nothing.

## Gate

```bash
cd web && npm run typecheck && npm run lint && npm test && npm run build && cd .. && bash scripts/sync-web.sh
```

Report to `docs/agent-briefs/reports/B5.md`.
