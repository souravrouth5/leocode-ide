# B3 — Root processes on the host: kill the real root pid, report loss, reap orphans

Read [`README.md`](README.md) first. **B1 and B2 must be merged.** This brief uses
`RootManager.buildRootCommand / buildRootShell / awaitRootPid / isRootPidAlive / canUseRoot /
markGranted / markLost` and `RootLostEvent(sessionId, jobId, reason)`.

## Context (verified by reading the code)

- **R-04, `proc.run {root:true}`.** `ProcessSupervisor.start` builds `[su, -c, cmd]` **without
  setsid**, so the `su` client sits in the app's own process group. On cancel,
  `rootManager.kill(job.pid, 15)` runs `kill -15 -<clientPid>` (no such group) and then
  `kill -15 <clientPid>`, which kills only the client. Under Magisk the real command runs as a child
  of `magiskd`, so it **keeps running as root**. `terminate()` then waits on `job.process` (the
  client), sees it exit, and reports success.
- **R-04, root terminal.** `PtySession.openShell(root=true)` runs `exec <su>` in the PTY. `destroy()`
  calls `onKillRoot(pid, …)` with the client pid and polls `ProcessStartTime.read(pid)`, also the
  client. Same leak.
- **R-03.** Nothing on the host emits `root.lost`. A refused `su` shows up as a generic non-zero
  exit (R-07).
- **R-06.** `TerminalRegistry` writes pidfiles of kind `root-term` and `ProcessSupervisor` writes
  `root-proc`, but `OrphanReaper` kills with `NativePty.killGroup` under the app UID. That can't
  signal root processes, and `/proc` is hidden for other UIDs, so `ProcessStartTime.read` returns
  null and the reaper silently drops the file. Root orphans survive a crash.
- Plan §8: **root is never requested at startup.**

## Files you may touch

- `android/app/src/main/java/dev/leocode/core/ProcessSupervisor.kt`
- `android/app/src/main/java/dev/leocode/core/Pty.kt` (`PtySession` root path only, no JNI/C changes)
- `android/app/src/main/java/dev/leocode/core/TerminalRegistry.kt`
- `android/app/src/main/java/dev/leocode/core/OrphanReaper.kt`
- `android/app/src/main/java/dev/leocode/core/PidFileStore.kt`, only if a field must be added
- New `android/app/src/main/java/dev/leocode/core/RootOrphanReaper.kt`
- `android/app/src/main/java/dev/leocode/bridge/ProcHandler.kt`, `TermHandler.kt`
- `android/app/src/main/java/dev/leocode/AppGraph.kt` (root wiring only)
- Their tests under `android/app/src/test/java/dev/leocode/...`

`RootManager.kt` and `Contract.kt` are frozen for this brief. If you need a change there, write it
under Open questions.

## Changes

### 0. Carried over from the B1 review

- **Liveness polling is expensive.** Every `su` call can show a Magisk toast and costs ~100 ms.
  While stopping a root process, check `isRootPidAlive` at most every 200 ms and at most ~10 times
  (2 s grace), never at the 25 ms `DESTROY_POLL_MS` used for normal PTYs.
- **Refusal vs. failure.** The wrapper writes the pidfile before anything else, so a missing
  pidfile + non-zero exit normally means `su` refused. Classify it as `denied` only when, in
  addition, nothing was printed to stdout. If the pidfile is missing but output came back,
  report a normal failed run (no `root.lost`, no `markLost`).
- **Diagnostics wording** (`AppGraph.diagnostics()`): enabled + `isGranted()` → "root mode enabled
  (granted)"; enabled + not yet verified → "root mode enabled (not verified this session)";
  available → "su binary present (not enabled)"; else "not detected".
- **RootHandler logger:** B2 adds a `log` lambda; pass
  `{ android.util.Log.i("LeoCodeRoot", it) }` from `AppGraph`.

### 1. R-04 — track and kill the real root pid

- Root pid files live in `<filesDir>/run/root/<id>.pid` (`id` = jobId or sessionId). `AppGraph`
  passes the directory in. The app creates the directory; the root wrapper writes the file.
- `ProcessSupervisor.start(spec.root)`: command = `[suPath, "-c", RootManager.buildRootCommand(argv,
  cwd, pidFile)]`. After start, resolve the root pid **off the caller thread** with
  `rootManager.awaitRootPid(pidFile)` and store it on the `Job`.
- `terminate(job)` for root jobs: if the root pid is known, `rootManager.kill(rootPid.pid, 15)`. Wait
  up to 2 s while `rootManager.isRootPidAlive(rootPid)`, then `kill(…, 9)`. **Never** call
  `NativePty.killGroup` or rely on `job.process.waitFor` as proof for a root job. If the root pid is
  unknown, fall back to today's client kill and `Log.w` it.
- `PtySession` root: the PTY command becomes `exec <su> -c '<RootManager.buildRootShell(pidFile)>'`
  (quoted correctly; keep the interactive shell). `destroy()` uses the recorded `RootPid` with
  `onKillRoot` / `isRootPidAlive`, not the client pid. Pass the needed callbacks in through
  `openShell`; `Pty.kt` must not depend on `RootManager` directly.
- Delete the root pidfile when the job/session finishes.

### 2. R-03 + R-07 — detect refusal and emit `root.lost`

- **Refused** = the root process exited, **its root pidfile never appeared**, and the exit code is
  non-zero. That means `su` refused before running our wrapper.
- On refusal: `rootManager.markLost()`, then emit **once** on that request's stream:
  `sink.event("root.lost", RootLostEvent(jobId = …, reason = "denied"))` (or `sessionId` for
  terminals). For `proc.run`, emit it before `proc.exit`. For terminals, before the exit event the
  page gets.
- On success (pidfile appeared): `rootManager.markGranted()`.
- `ProcHandler` / `TermHandler`: replace the `isAvailable()` / `isEnabled()` checks with
  `!isAvailable()` → `E_ROOT_UNAVAILABLE`, `!canUseRoot()` → `E_ROOT_DENIED`.
- A shell that is already running as root is **not** affected by a revoke in Magisk. Don't try to
  detect that; it's documented in the contract (B2).

### 3. R-05 host half — `root.disable` ends root work

- `TerminalRegistry.closeRoot()` closes only root sessions (each one through the root kill path).
  `ProcessSupervisor.cancelRoot()` cancels only root jobs.
- `AppGraph`: build `RootHandler(rootManager, json, onDisabled = { terminals.closeRoot();
  supervisor.cancelRoot() })`.

### 4. R-06 — root orphans, lazily

- `OrphanReaper.reap()` **skips** `root-proc` / `root-term` records and leaves their files. It can't
  kill them, and startup must not run `su`.
- New `RootOrphanReaper(dir, rootManager)` with `reapPending(): Int`. For each root pidfile left by a
  previous process: `parseRootPidFile`, then if `isRootPidAlive`, kill group TERM → 200 ms → KILL.
  Delete the file in every case. Runs **only** when `canUseRoot()`.
- Call it (once per app process, off the main thread) right before the first root job or root
  session starts, and after a successful `root.request`. Wire it in `AppGraph`.

## Tests

- `ProcessSupervisorTest`: inject a fake `RootManager` (it is a class with a `ShellRunner` seam; use
  a fake runner + temp dir) or a small root-ops interface you introduce **inside** these files.
  Cover:
  - root cancel kills the recorded root pid and never calls the client kill when the pid is known;
  - a root job whose pidfile never appears and exits 1 → exactly one `root.lost` (`reason=denied`,
    correct `jobId`) before exit, `markLost` called;
  - a pidfile that appears → `markGranted`;
  - `cancelRoot()` leaves non-root jobs running.
- `TerminalRegistryTest`: `closeRoot()` closes root sessions only, and root sessions record kind
  `root-term`.
- `OrphanReaperTest`: root kinds are skipped and their files kept; normal kinds unchanged.
- New `RootOrphanReaperTest`: stale start time → no kill, file deleted; alive + matching → TERM then
  KILL; `canUseRoot()` false → no shell calls, files kept.
- `ProcHandlerTest` / TermHandler test: `E_ROOT_UNAVAILABLE` vs `E_ROOT_DENIED` mapping.
- Existing non-root tests must stay green unchanged.

## Gate

```bash
./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug
```

In the report, list the device checks this brief needs (the owner runs them): root `sleep 600` via
Run as root → Stop → `su -c "ps -A -o PID,PGID,USER,NAME | grep sleep"` is empty; the same for a
root shell running `sleep 600` → Exit Root Shell; deny in Magisk → new root shell → `root.lost`.

Report to `docs/agent-briefs/reports/B3.md`.
