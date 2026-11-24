# B1 — RootManager: real timeouts, no prompts from status, root-pid helpers

Read [`README.md`](README.md) first (rules, paths, gates, report format).

## Context

`android/app/src/main/java/dev/leocode/core/RootManager.kt` runs every `su` call through
`ProcessShellRunner`. Three problems:

1. **R-01, timeouts don't work.** `ProcessShellRunner.run` reads stdout to EOF, then stderr to
   EOF, and only then calls `waitFor(timeoutMs)`. If `su` blocks (a Magisk prompt nobody answers,
   a hung daemon), `readText()` never returns, so the 3 s / 30 s / 2 s timeouts never fire and the
   bridge worker thread hangs. A child that fills the stderr pipe while we block on stdout can also
   deadlock.
2. **R-02, `root.status` can prompt.** With root mode enabled, `status()` → `isGranted()` runs
   `su -c id`. If the grant was revoked, or Magisk's policy for LeoCode is "prompt", that opens a
   superuser prompt. This breaks D-011 and `docs/bridge-contract.md` ("`root.status` never
   prompts"). `AppGraph.diagnostics()` also calls `isGranted()`. Every status call runs `su`.
3. **R-04 groundwork.** Under Magisk, the app's `su` is only a client. `magiskd` forks the real
   root process in its own tree, so a kill aimed at the client pid misses it. B3 will kill the
   real root pid, but needs pure helpers from this brief to learn it.

## Files you may touch

- `android/app/src/main/java/dev/leocode/core/RootManager.kt`
- `android/app/src/test/java/dev/leocode/core/RootManagerTest.kt`
- New test helpers under `android/app/src/test/java/dev/leocode/core/` if needed

Nothing else. Keep the existing public API source-compatible unless this brief says otherwise.
`ProcessSupervisor`, `Pty`, `TermHandler`, `ProcHandler`, `RootHandler` and `AppGraph` call it.

## Changes

### 1. R-01 — `ProcessShellRunner` with enforced timeouts

- Add a seam so tests can inject a process:
  `class ProcessShellRunner(private val start: (List<String>) -> Process = { ProcessBuilder(it).start() })`.
- Close the child's stdin right away.
- Drain stdout and stderr on **two daemon threads** into bounded buffers (cap 64 KiB each; extra
  bytes are read and discarded so the child never blocks on a full pipe).
- `waitFor(timeoutMs)` on the calling thread. On timeout: `destroyForcibly()`, join the readers for
  at most 500 ms, return `ShellResult(-1, <captured>, "timeout after ${timeoutMs}ms")`.
- Any exception → `ShellResult(-1, "", <message>)`. Never throw from `run`.
- The whole call returns within `timeoutMs + ~1 s` no matter what the child does.

### 2. R-02 — cached grant; `status()` never runs `su`

- Add `@Volatile private var grantCache: Boolean? = null` (null = not verified in this process).
- `isGranted()` → `isEnabled() && grantCache == true`. **No shell call.**
- `status()` → **zero shell calls** in every state. `granted` = `grantCache == true`.
- `requestGrant()` (the only user-initiated prompt): exit 0 → `grantCache = true`, prefs enabled.
  Otherwise `grantCache = false`, prefs disabled, throw `E_ROOT_DENIED` (as today). A timeout
  (exit -1 with the timeout stderr) is also a denial, but the message must say it timed out.
- New `fun canUseRoot(): Boolean = isAvailable() && prefs.isEnabled() && grantCache != false`.
  Unknown (`null`, e.g. after an app restart with root mode on) is allowed: the next root
  operation is user-initiated, and Magisk won't prompt for an app that is already allowed.
- New `fun markGranted()` (`grantCache = true`) and `fun markLost()` (`grantCache = false`; does
  **not** change the enabled preference, so the UI can offer "Try again").
- `setEnabled(false)` clears `grantCache` to `null`. `setEnabled(true)` keeps today's
  `E_ROOT_UNAVAILABLE` check.

### 3. R-08 — su paths

- Add `/debug_ramdisk/su` and `/system_ext/bin/su` to `DEFAULT_SU_PATHS`.
- Do **not** add `/data/adb/...`: an `untrusted_app` cannot stat it, so `exists()` is always
  false. Put a comment saying that.

### 4. Root-pid helpers (used by B3), pure functions in the companion

The real root process records its own pid and kernel start time in a file the app can read:

```kotlin
/** `echo "$$ $(cut -d' ' -f22 /proc/$$/stat)" > '<pidFile>' && cd '<cwd>' && exec 'a' 'b' … */
fun buildRootCommand(argv: List<String>, cwd: File, pidFile: File): String

/** Same pid line, then `exec /system/bin/sh -i` (root PTY shell). */
fun buildRootShell(pidFile: File): String

/** Parses "<pid> <starttime>" → RootPid(pid, startTime) or null (missing/garbled/pid<=1). */
fun parseRootPidFile(text: String): RootPid?
data class RootPid(val pid: Int, val startTime: Long)
```

All paths and argv elements go through `quoteArg`. Keep `buildShellCommand` working (it has
callers until B3 removes them).

Instance helpers (each one runs `su` with a short timeout, and only when `canUseRoot()` holds):

```kotlin
/** Polls pidFile until parseRootPidFile succeeds or timeoutMs (default 2000) elapses. No su. */
fun awaitRootPid(pidFile: File, timeoutMs: Long = 2_000, pollMs: Long = 25): RootPid?
/** `su -c "kill -0 <pid>"` AND the start time still matches (read via su from /proc/<pid>/stat). */
fun isRootPidAlive(rp: RootPid): Boolean
```

Keep `kill(pid, signal)` as is (group first, then pid).

## Tests (RootManagerTest, extend the existing fakes)

- Runner: a fake `Process` whose stdout never reaches EOF → `run(..., 300)` returns in < 1.5 s with
  exit -1, the timeout message, and `destroyForcibly` called.
- Runner: a fake that writes 1 MiB to stderr before exiting → returns, stderr capped to 64 KiB,
  real exit code.
- Runner: `start` throws → exit -1, no exception escapes.
- `status()` with prefs enabled + su available → **zero** `executedCommands`, `granted=false`
  before any request, `true` after a successful `requestGrant()`.
- `isGranted()` makes no shell calls in any state.
- `requestGrant()` denied/timeout → `E_ROOT_DENIED`, cache false, `canUseRoot()` false; `markLost`
  keeps prefs enabled; `setEnabled(false)` resets the cache so `canUseRoot()` is false only because
  of prefs.
- `buildRootCommand`/`buildRootShell` quoting: cwd and argv with spaces, `'`, `$`, backticks and
  `;` stay single literal arguments. Assert the exact string for one simple case.
- `parseRootPidFile`: valid, trailing newline, empty, non-numeric, pid 0/1 → null.
- `awaitRootPid`: file appears after 100 ms → returned; never appears → null near the timeout.

## Gate

```bash
./gradlew --no-daemon testDebugUnitTest --tests 'dev.leocode.core.RootManagerTest'
./gradlew --no-daemon testDebugUnitTest lintDebug
```

Report to `docs/agent-briefs/reports/B1.md`.
