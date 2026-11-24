# B2 + B3 review (branch `phase-e-root`)

> **Follow-up (B3-fix): accepted.** F1–F4 were checked in the code. Terminal refusal is now
> `no pidfile && code != 0`. `RootOrphanReaper` skips ids for which `isActive` is true
> (`terminals.has || supervisor.has`), and the reaper runs once per process through
> `ensureRootOrphansReaped()`. `terminate()` / `destroy()` wait synchronously (2 s) for the root
> pid before falling back. `OrphanReaper` deletes root-kind records without signalling. Full suite:
> 511 passed / 0 failed / 1 skipped (agent's report).
> One known minor cost, accepted: on a refused root PTY, `destroy()` on the pump thread waits up
> to 2 s for a pidfile that will never appear. It runs after `finish()`, so the exit event and the
> `root.lost` banner are not delayed.

---

**Verdict: B2 accepted as is. B3 needs four fixes (F1–F4) before the device pass.** The structure
is right: contract lock, clean merge, disjoint scopes, and the full suite is green (509 passed,
0 failed, 1 skipped, per the merge report). F1 and F2 are real bugs that the unit tests can't see,
because the fakes don't behave like a real PTY or a running app.

Reviewed: `B2.md`, `B3.md`, `B2-B3-merge.md`, plus the merged code in `RootHandler.kt`,
`ProcessSupervisor.kt`, `Pty.kt`, `TerminalRegistry.kt`, `OrphanReaper.kt`, `RootOrphanReaper.kt`,
`PidFileStore.kt`, `ProcHandler.kt`, `TermHandler.kt` and `AppGraph.kt`.

## B2: accepted

- Direct `android.util.Log` calls removed. The `log` lambda is injected and `AppGraph` passes the real logger. That fixes the 3 red `RootHandlerTest`s.
- `root.disable`: `setEnabled(false)`, then the hook in `runCatching` (failure logged), then `status()`. Idempotent, and never runs `su`. ✅
- `root.status` logs only when the state changes. ✅ `bridge-contract.md` rows updated. ✅ `types.gen.ts` diff clean. ✅

## B3: what's right

- Root jobs run as `su -c <buildRootCommand>`. The real pid is resolved off-thread, and stop
  targets that pid with TERM → 200 ms polling for up to 2 s → KILL. `NativePty.killGroup` is never used for root work. ✅
- Root PTYs run `exec <su> -c '<buildRootShell>'` (quoted once). `destroy()` uses the real pid with 200 ms polling. ✅
- `root.lost` reaches the right stream: `ProcHandler` → `onRootLost` → `sink.event`, and
  `TermHandler` → `Listener.rootLost` → `sink.event`. ✅ `E_ROOT_UNAVAILABLE` / `E_ROOT_DENIED` mapping. ✅
- `closeRoot()` / `cancelRoot()` are wired into `root.disable`. Diagnostics wording fixed. ✅
- The startup `OrphanReaper` never runs `su`. `RootOrphanReaper` is lazy and gated on `canUseRoot()`. ✅

## Fixes

### F1 (High): a refused root **terminal** never sends `root.lost`

`TerminalRegistry.pump` treats a session as refused only if `session.totalBytesReceived == 0`. A
PTY merges stderr into the same stream, so when Magisk refuses, `su`'s own "Permission denied"
arrives as terminal output. The bytes are > 0 and the refusal is never reported. (The
"no output" rule came from the B3 brief and was meant for `proc.run`, where stdout and stderr are
separate. It doesn't apply to PTYs, and that was my mistake in the brief.)

**Fix:** for terminals, refusal = root pidfile never appeared **and** exit code ≠ 0. Ignore the
output. Keep the `proc.run` rule (stdout empty) as it is. **Test:** a fake PTY that emits
`"Permission denied\r\n"`, exits 1 and writes no pidfile must produce exactly one `root.lost`
(`reason=denied`, its `sessionId`) before exit, plus `markLost`.

### F2 (High): enabling root again can kill the user's own live root sessions

`AppGraph.rootPrefs.setEnabled(true)` starts `rootOrphanReaper.reapPending()` on every successful
`root.request`. The reaper treats **every** `run/root/*.pid` as an orphan, including the ones that
belong to root shells and jobs running right now in this process. Example: the user taps "Try
again" after a `root.lost` while another root shell is open. The reaper sees that shell's pidfile
as alive and matching, and sends TERM/KILL. The same race exists on the first root job: the reaper
thread runs concurrently with the job it was started for.

**Fix:** pass `isActive: (id: String) -> Boolean` to `RootOrphanReaper`. `AppGraph` wires it to
"`terminals` has a session with that id **or** `supervisor` has a job with that id" (add small
`has(id)` helpers). Skip those files and don't delete them. Also run the reaper at most once per
process, using the existing `rootReaperRan` flag for both call sites. Drop the separate
post-enable thread and call `ensureRootOrphansReaped()` instead. **Tests:** an active id is never
signalled and its file is kept; a stale id is still reaped.

### F3 (Medium): pressing Stop in the first ~100–300 ms leaks the root process

`terminate()` (`ProcessSupervisor`) and `destroy()` (`PtySession`) fall back to killing the `su`
client when the root pid isn't known yet. The pid is resolved on another thread, and Magisk takes
a moment, so an early Stop or Exit Root Shell leaves the real process running.

**Fix:** if `rootPid` is null, first call `awaitRootPid(pidFile, timeoutMs = 2_000)`
**synchronously** (the job/session knows its pidfile). Use the client-kill fallback only if that
returns null. For the PTY, pass the pidfile-await lambda into `destroy` (it's already passed to
`openShell`). Keep it on the caller's thread; `terminate` already runs off the UI thread. **Test:**
cancel immediately after start with a pidfile that appears 150 ms later → the root pid is killed and
the client kill is not used.

### F4 (Low): root-kind records in `files/run/` are never removed

`OrphanReaper` now skips `root-proc` / `root-term` records but keeps their files. The real root pid
lives in `files/run/root/` (that's what `RootOrphanReaper` reads), so these app-side records have
no further use. After a crash they pile up forever. **Fix:** in `OrphanReaper.reap()`, delete
root-kind records without signalling anything. Update the test: root records are deleted, with no
kill call.

## Added to the device pass (plan §2, E-08)

- Root kill reaches **children**: Run as root a script `sleep 600 & sleep 601 & wait` → Stop →
  `su -c "ps -A -o PID,PGID,USER,NAME | grep -E 'sleep 60[01]'"` must be empty. Under Magisk the
  root shell may not be a process-group leader. In that case `kill -<sig> -<pid>` fails and the
  fallback only kills the shell. If children survive, the fix is to start the root command with
  `setsid` and record the group.
- Stop within 0.5 s of starting a root job (covers F3).
- Re-request root while a root shell is open (covers F2): the open shell must survive.
