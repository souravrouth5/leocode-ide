# B4 + B5 review (branch `phase-e-root`)

> **Follow-up (B4-B5-fix, `cf31792`): accepted.** Checked in the code: F1 `lastLost: null` on
> `requestRoot` success and `disableRoot` success. F2 the mock `rootDisable` closes sessions and
> sends no `root.lost`. F3 `runStore` matches only `event.jobId === current.jobId`. Web 494/494
> (agent's report). This round only ran `assembleDebug` on Android (no Kotlin changes, so the
> 511-pass count carries over). Next: `DEVICE-phase-e.md`.

---

**Verdict: accept after three small web fixes (F1–F3).** The merge is clean and the gates are
green (web 491/491, Android 511 passed / 0 failed / 1 skipped, APK built, per the agent's merge
report). The structure matches the briefs. The three fixes are about state that never resets,
plus one place where the mock doesn't behave like the real host.

Reviewed: `B4.md`, `B5.md`, `B4-B5-merge.md`, plus the code in `rootStore.ts`, `phantom.ts`,
`SettingsDialog.tsx` (root parts), `TerminalPane.tsx`, `runStore.ts`, `bridge/android.ts` and
`bridge/mock.ts` (root parts).

## What's right

- `disableRoot` is async through `root.disable`, keeps the old state and rethrows on error. `onRootLost` keeps `enabled`,
  clears `granted` and records `lastLost`. `requestRoot` success re-checks status. ✅
- `liveRootCount`: every path that increments has a matching decrement (exit, unmount, `root.lost`,
  Exit Root Shell, run exit/close), and the count is clamped at 0. ✅
- R-10: the header shows `ROOT MODE` while root mode is enabled; the status bar, terminal and run bar
  show `# ROOT` only while a root process is alive. ✅
- `E_ROOT_DENIED` → sheet + retry. ✅
- B5: `phantom.ts` is a pure predicate with the exact argv and 15 s timeout, sent through
  `bridge.run({ root: true })`. The SDK comes from `app.info.androidSdk`, with diagnostics as a
  fallback; unknown → hidden. A confirm dialog comes first, and nothing is persisted. ✅

## Fixes

### F1 (Medium): `lastLost` is never cleared

`rootStore.lastLost` is set on `root.lost` and never reset. `SettingsDialog` treats
`lastLost !== null` as "lost", so after one refusal the phantom option stays hidden for the rest of
the app run, even after "Try again" succeeds. **Fix:** set `lastLost: null` when `requestRoot`
succeeds and when `disableRoot` succeeds. **Test:** a loss, then a successful `requestRoot`, gives
`lastLost === null`, and the phantom button shows again.

### F2 (Medium): the mock's `rootDisable` sends `root.lost`; the real host doesn't

`MockBridge.rootDisable()` calls `emitRootLost({ sessionId, reason: "revoked" })` for every mock root
session. On the device, `root.disable` closes root sessions (the terminal just exits) and **never**
sends `root.lost`. Because of this mismatch, in the browser/mock a deliberate disable shows the
"Root access was refused" banner and sets `lastLost`, and the mock test asserts that wrong
behaviour. **Fix:** in the mock, close root sessions through the normal exit path with no
`root.lost`. Update `mock.test.ts` to assert sessions exit and **no** `root.lost` is sent.

### F3 (Low): the run sheet can claim a `root.lost` that belongs to another job

`runStore` accepts `root.lost` when `event.jobId === current.jobId || runningRoot`. Any root job
refused while a root run is active matches, for example the phantom "Apply" command
(`bridge.run` has its own jobId). **Fix:** match on `event.jobId === current.jobId` only. `jobId`
is set from the `proc.run` reply, which arrives before any stream event. **Test:** a `root.lost`
with a different jobId while a root run is active doesn't touch the run sheet.

## Device pass

After F1–F3, rebuild the APK (`scripts/sync-web.sh` + `assembleDebug`). That APK carries all of
Phase E. Run plan §2 rows E-01…E-18 on D2 (and E-01, E-02 and E-10 on D1).
