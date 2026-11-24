# B6 — Kill root terminals by session; catch failed root retries

Read [`README.md`](README.md) and [`reports/DEVICE-phaseE-review.md`](reports/DEVICE-phaseE-review.md)
first. This fixes P1 and P3 from the device review. One agent, no worktrees.

## Step 0 — device probe (read-only, before writing any code)

D2 (`e76846f`), policy allow, root mode on. Open a Root Shell and run `sleep 600` in the
foreground, then:

```bash
adb -s e76846f shell su -c "ps -A -o PID,PPID,PGID,SID,USER,NAME" | grep -E " (sh|sleep|su|magiskd)\b"
adb -s e76846f shell su -c "cat /data/data/dev.leocode/files/run/root/*.pid"
adb -s e76846f shell su -c "pkill --help 2>&1 | head -5"
```

Record the output in the report. **Expected:** the root `sh` has `SID == PID == the pidfile pid`,
and `sleep 600` has the same SID but its own PGID. **If the root `sh` is NOT a session leader
(SID ≠ its PID), STOP and report.** Killing by session would then hit processes we don't own.

## Files you may touch

- `android/app/src/main/java/dev/leocode/core/RootManager.kt` + `RootManagerTest.kt`
- `android/app/src/main/java/dev/leocode/core/Pty.kt` (root `destroy()` path only)
- `android/app/src/main/java/dev/leocode/core/RootOrphanReaper.kt` + test
- `android/app/src/main/java/dev/leocode/AppGraph.kt` (root PTY wiring only)
- `web/src/features/layout/AppDialogs.tsx`, `web/src/features/terminal/TerminalPane.tsx` (root retry only)
- New `web/src/features/root/retryRoot.ts` + test; existing root tests next to the files above

## Changes

### 1. `RootManager.killSession(sid: Int, signal: Int): Boolean`

One `su` call. It doesn't depend on `pkill` and copes with spaces in `comm`:

```sh
for p in /proc/[0-9]*; do
  s=$(sed 's/.*) //' "$p/stat" 2>/dev/null | cut -d' ' -f4)
  [ "$s" = "<sid>" ] && kill -<sig> "${p#/proc/}" 2>/dev/null
done; true
```

Guard: `sid > 1`, no-op unless `canUseRoot()`. The command is built by a pure companion
`buildSessionKillCommand(sid, signal)`. Its test asserts the exact string and that `sid` and
`signal` are integers only (no injection surface).

### 2. Root PTY `destroy()` uses the session

`TERM` → `killSession(rootPid, 15)`; wait while `isRootPidAlive` (200 ms polls, 2 s max); then
**always** `killSession(rootPid, 9)` once, to catch foreground or background jobs that outlived
the shell. Keep the group kill as is for root **jobs** (`ProcessSupervisor`). Pass the session-kill
callback into `PtySession` the same way `onKillRoot` is passed now; `Pty.kt` must not import
`RootManager`.

### 3. `RootOrphanReaper` uses the session for `root-term` records

The reaper can't tell from the root pidfile whether it came from a terminal or a job. Since a
matching start time proves the pid is our root `sh`, use `killSession` for **every** reaped root
pid: TERM → 200 ms → KILL. A job's `sh` is also a session leader under `su -c`. If step 0 shows
otherwise for jobs, keep the group kill for jobs and say so in the report.

### 4. Web: one root retry helper (P3)

`retryRoot(stores)` = `try { return await stores.root.getState().requestRoot() } catch (e) {
stores.errors.getState().report(e, { context: "Request root", retry: () => void retryRoot(stores) }); return false }`.
It never rejects. Use it for the `AppDialogs` error-sheet retry **and** the `TerminalPane` /
`RunSheet` banner Try again (remove the silent `catch {}`).

## Tests

- `RootManagerTest`: exact `buildSessionKillCommand`; `killSession` makes no shell call when
  `canUseRoot()` is false or `sid <= 1`; exactly one `su` call otherwise.
- PTY root destroy (fake callbacks): TERM session, then the poll, then one KILL session, even when
  the shell is already gone.
- `RootOrphanReaperTest`: an alive matching pid is killed via session TERM then KILL; the
  active/stale cases are unchanged.
- `retryRoot.test.ts`: a rejection is reported with context "Request root" and never escapes
  (`unhandledrejection` spy stays at 0); success returns true. Banner Try again → failure → error
  reported (not swallowed).

## Gates

```bash
cd android && flock /tmp/leocode-gradle.lock ./gradlew --no-daemon testDebugUnitTest lintDebug
cd ../web && npm run typecheck && npm run lint && npm test && npm run build && cd .. && bash scripts/sync-web.sh
scripts/build-release.sh 0.1.0-rc11 1011 https://github.com/souravrouth5/leocode-ide/releases/download/rc/release.json
```

Then install rc11 on D2 (`scripts/smoke.sh e76846f <apk>`) and run the **Re-run table** in
`reports/DEVICE-phaseE-review.md`, pasting **raw** command output for every check. Commit the code
as `root: kill root terminals by session; catch failed root retries (B6)`. Write
`reports/B6.md` (step 0 output, gates, test counts, re-run rows with raw output and screenshots).
