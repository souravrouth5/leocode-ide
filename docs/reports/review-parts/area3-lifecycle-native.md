# Area 3: lifecycle and native (Tasks 8, 9, 10)

Branch `v9-impl`, HEAD 4389983. Method: read the files in the brief, the plan (§4.2, §7, Tasks 8-10), PROGRESS.md and `docs/reports/task{8,9,10}-verification.md`. Nothing was executed (no gradle/adb). Line numbers are the current files. Confidence tags: CONFIRMED BY READING, or SUSPECTED with the check that would confirm it.

## Summary

Two High findings: `killGroup`/`OrphanReaper` can signal pid 1 or the app itself (`kill(-1)`), and an exception in `LeoApp.onCreate` makes the crash-recovery path unreachable (crash loop on every launch). The native fork/exec path itself is sound. The weaker areas are the service lifecycle (start/stop ordering), the registry lock held across a blocking PTY write, exited sessions becoming unreachable, and several Android-version gaps that no device run covered (Android 11-14, landscape insets, background renderer loss). Task 8 and Task 9 device demos are still pending per PROGRESS.md.

---

## Findings

### High

**L-01. `killGroup` has no guard for pid 1, the app's own pid, or its own process group** — High, CONFIRMED BY READING (reachability low)
- `pty.c:351-358` (`killGroup`), `OrphanReaper.kt:31-53` (reap loop, kill calls at 44-46), `PidFileStore.kt:42-50` (`parse` accepts any pid > 0).
- Scenario: a pidfile reads `1 0 term` (corrupt, hand-edited, or written with start time 0). `OrphanReaper.reap` computes `sameProcess = current != null && (record.startTime <= 0 || ...)`. `/proc/1/stat` is readable, so `sameProcess` is true. `killGroup(1, SIGTERM)` runs `kill(-1, SIGTERM)`. That signals every process the app uid may signal, including the app itself and its WebView helpers. The same applies to pid equal to `getpid()` or `getpgrp()`. Android 9 to 16.
- Why wrong: the briefing's safety guard is only `pid <= 0`. `-pid` with pid 1 is the "all processes" form. A second path to the same bug is L-02's start-time 0 bypass.
- Fix: in native `killGroup` (and in `OrphanReaper` before calling it) reject `pid <= 1`, `pid == getpid()`, and `pid == getpgrp()`. Also reject `pid` above `/proc/sys/kernel/pid_max`.
- Test gap: no test for these inputs.

**L-02. Exception in `LeoApp.onCreate` makes `RecoveryActivity` unreachable** — High, CONFIRMED BY READING
- `LeoApp.kt:20-27` (`graph = AppGraph(this); graph.workspace.ensure()` unguarded), `Workspace.kt:22-28` (`ensure()` throws `IllegalStateException`).
- Scenario: `files/usr` (or `tmp`, `home`) is missing and `mkdirs()` fails (disk full, read-only data partition, a dangling symlink at that path). `CrashStore.install` has already run, so a record is written. Next launch: `Application.onCreate` runs before any Activity, throws the same exception again, and the process dies before `MainActivity.onCreate` can call `CrashStore.consume`. The user sees "app keeps stopping" forever until Clear data. Android 9 to 16.
- Why wrong: the `LeoApp` KDoc and Task 8 say "if graph construction throws, the next launch opens RecoveryActivity". That cannot happen: consume lives in `MainActivity`.
- Fix: make `graph` lazy and catch failure in `onCreate` (log, set a `startupError`), let `MainActivity` show Recovery when `startupError != null`. Or let `RecoveryActivity` be the launcher fallback when `CrashStore` has a record and graph creation fails. Do `ensure()` lazily with a retry.

### Medium

**L-03. Foreground-service start/stop ordering can drop the service while sessions are alive, or leave a stale one** — Medium, SUSPECTED
- `SessionService.kt:72-81` (count 0 → `stopSelf()`), `AppGraph.kt:138-165` (`sessionCountChanged` computes under `countLock`, delivers outside it).
- Scenario A (stopSelf): job 1 ends (count 0 → `update(0)` queued), job 2 starts immediately (count 1 → `update(1)` queued). `onStartCommand(0)` calls `stopSelf()`, which is unconditional (no startId). The queued `update(1)` is dropped or runs on a service that is being destroyed. Sessions are running with no foreground service and no notification. Rapid sequential `proc.run` calls (git status, formatter, test runner) make this plausible. Android 8 to 16.
- Scenario B (ordering): thread A (terminal pump) computes total=1, thread B (supervisor) computes total=0, B calls `update(0)` first, then A calls `update(1)`. The service shows "1 process running" with zero sessions, and holds the process alive.
- Fix: `stopSelf(startId)` so a later start wins; have the service read `graph.runningCount()` itself instead of trusting the intent extra; or send intents under one lock.
- Confirm: from the web console run `proc.run` of a trivial command twice back to back while a third long job is not running, then check `adb shell dumpsys activity services dev.leocode` for `isForeground=true` while the second job is still alive.

**L-04. `Session.write` holds the session lock across a blocking PTY write** — Medium, CONFIRMED BY READING the lock; blocking behaviour SUSPECTED
- `TerminalRegistry.kt:320-322` (`write` is `synchronized(lock) { pty.write }`); `PtySession.write` is a blocking `Os.write` on the master (`Pty.kt:105-113`).
- Scenario: user pastes ~100-190 KB (`term.write` accepts up to the 256 KB message cap) while the foreground program does not read stdin (`sleep 100`, a running build). Once the tty flip buffer is full the master write blocks. While it blocks, `received()` (pump thread, line 301), `ack`, `attach`, `resize`, `finish` and `close()` all wait for the same lock. Output stops, the session cannot be closed from the UI, and `closeAll`/Stop all hang on that session. Android 9 to 16.
- Fix: do not hold `lock` during the write. Take the lock only to check `alive`, then write outside it, or give each session a separate write lock/queue with a bounded size.
- Confirm: `adb shell`: in the terminal run `sleep 300`, paste 150 KB, then try closing the tab. `cat /proc/<bridge-thread tid>/wchan` shows the tty write wait.

**L-05. An exited session disappears immediately, so its exit code and scrollback are never reachable** — Medium, CONFIRMED BY READING
- `TerminalRegistry.kt:183` (`sessions.remove(session.id, session)` in the pump `finally`), `TermHandler.kt:408-409` (`attach` → `E_NOT_FOUND`).
- Scenario: the shell exits while the WebView is detached (user typed `exit`, the shell was SIGKILLed by the Android 12+ phantom-process killer, or an OOM kill). The user returns, the web calls `term.attach`, gets `E_NOT_FOUND`, and (per the Task 10 report) falls back to `openTerminal`. The ring buffer, `alive=false` and `exitCode` fields of `TermAttachReply` are unreachable except in a sub-millisecond race. The user loses exactly the output that explains why the shell died.
- Test mismatch: `TerminalRegistryTest.kt:151-173` is named "attach to an exited session reports scrollback and the exit code" but asserts `attach == null`.
- Fix: keep exited sessions in the map until the web closes them (or for N minutes / the next `term.open`), still excluded from `activeCount()`.

**L-06. `OrphanReaper` only recognises an orphan when the group leader is still alive** — Medium, SUSPECTED
- `OrphanReaper.kt:39-44`, `ProcessStartTime.kt:13-23`.
- Scenario: the app process dies. The kernel hangs up the PTY, the shell (leader) exits, but a `nohup`/background child (`python -m http.server &`) keeps running in the same group (pgid == old shell pid). Next start: `startTime(leaderPid)` is null, so `sameProcess` is false, the pidfile is deleted, and the group is never signalled. It is now untracked and invisible to Stop all. (On AMS-initiated kills the cgroup kill usually removes children, so this mostly affects lmkd kills and crashes.)
- Fix: when the leader is gone, scan `/proc/*/stat` for entries with `pgrp == record.pid && sid == record.pid` whose start time is newer than the pidfile's leader start time, and signal those.
- Confirm: start a terminal, run `nohup sleep 999 &`, `adb shell kill -9 <app pid>`, relaunch, `adb shell ps -A | grep sleep`.

**L-07. `startTime <= 0` skips the pid-reuse check** — Medium, CONFIRMED BY READING
- `PidFileStore.kt:18` (`ProcessStartTime.read(pid) ?: 0L`), `OrphanReaper.kt:40-41`, `ProcessStartTime.kt:25-28` (`matches`).
- Scenario: `/proc/<pid>/stat` cannot be read at write time (child died or was slow to appear). The pidfile stores 0. At next start any process that reuses that pid is treated as the orphan and its group is killed. Same-uid victims include the app's own helper processes. Android 9 to 16.
- Fix: do not write a pidfile when the start time is unknown (or retry once), and treat `startTime <= 0` as "do not kill". Also store the boot id so a pidfile from before a reboot is discarded.

**L-08. Back-pressure stalls a backgrounded terminal once 256 KB is unacked** — Medium, SUSPECTED
- `TerminalRegistry.kt:275-291` (`reserve` blocks while a listener is attached and credit ≤ 0), `MainActivity.kt` `onPause` → `webView.onPause()` (no detach in `onStop`).
- Scenario: user starts `pip install`/`npm install`/a verbose build, presses Home. The Activity is stopped but not destroyed, so the listener stays attached and `WebView.onPause()` pauses page processing; if the page stops acking, the pump blocks after 256 KB and the child blocks on its tty write. The job appears frozen until the user returns. The Task 10 demo used `sleep 600; echo done`, which prints almost nothing, so it does not test this. Android 9 to 16.
- Fix: detach the listener (ring-buffer only mode) in `onStop`, and re-attach in `onStart`; or never block the pump when the Activity is not resumed.
- Confirm: run `yes | head -c 5000000`, press Home for 30 s, `adb shell cat /proc/<pid of head>/wchan` / `ps` state, then return.

**L-09. Renderer loss while backgrounded: immediate rebuild, then a blocked `startActivity` followed by `finish()`** — Medium, SUSPECTED
- `MainActivity.kt:481-512`.
- Scenario: low-memory device (D1, 3.8 GB, MIUI). The renderer is killed while the app is in the background. `handleRendererGone` rebuilds the WebView at once, which starts a new renderer under the same memory pressure. A second loss inside 60 s is then likely. The code calls `startActivity(RecoveryActivity)`, which Android 10+ blocks as a background activity start (plan §4.2 says "we never start activities from background"), and then `finish()`es `MainActivity`. Result: no UI, no recovery screen, process alive under the service. Android 10 to 16.
- Also: `rendererLossAt` is an Activity field (line 87); recreation resets the "2 in 60 s" rule.
- Fix: if not resumed, set a flag and rebuild in `onResume`; show Recovery from `onResume`; keep the loss timestamps in `LeoApp`/`SharedPreferences`.
- Confirm: `adb shell am send-trim-memory`-style pressure, or kill the `webview_zygote`/`com.google.android.webview:sandboxed_process` twice with the app in the background, and read `logcat | grep "Background activity start"`.

**L-10. `configChanges` is incomplete, so common system changes recreate the Activity and reload the WebView** — Medium, SUSPECTED
- `AndroidManifest.xml:25` (`orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize|uiMode`).
- Missing: `keyboard`, `navigation`, `fontScale`, `density`, `locale`, `layoutDirection`, `colorMode`. Connecting a Bluetooth/USB keyboard (a normal IDE workflow) changes `keyboard`, which recreates the Activity. So do font-size and language changes. The Task 10 report confirms recreation on `wm density`. The web page reloads and anything not yet saved by the editor is at risk. Terminal sessions survive (good), but the user sees the "restored" flow without a renderer loss.
- Fix: add the missing flags, or confirm the web layer autosaves before unload.
- Confirm: `adb shell settings put system font_scale 1.3` with an unsaved edit open.

**L-11. Insets forward only top and bottom, not left/right or cutout** — Medium, SUSPECTED
- `MainActivity.kt:570-590` (`applyWindowInsets`, `pushInsets`).
- Scenario: `WindowCompat.setDecorFitsSystemWindows(false)` draws under all system bars. In landscape with a 3-button navigation bar on the side (still the default on many Android 9 and MIUI devices, including D1 if not set to gestures) and on notch devices (Redmi Note 7S), the left/right inset (navigation bar, cutout) is never sent, so IDE content sits under the bar. `nav.bottom` itself is correct on API 28-29 (compat takes the min of system and stable insets).
- Fix: also publish `--inset-left`/`--inset-right` from `systemBars()|displayCutout()`, and use `max(status, cutout)` for top.
- Confirm: D1 landscape with navigation buttons.

**L-12. No cap on terminal sessions** — Medium, CONFIRMED BY READING
- `TermHandler.kt:364-377`, `TerminalRegistry.kt:79-96`.
- Each `term.open` forks a shell, adds a pump thread and a 256 KB ring. Nothing bounds the count. A web loop (attach fallback calling `openTerminal` on every failed attach, React remount) can exhaust fds/threads/`RLIMIT_NPROC` and the phantom-process limit (32 on Android 12+). Rows/cols are also not range-checked (`set_winsize` truncates to `unsigned short`).
- Fix: reject `term.open` over a limit (e.g. 8) with `E_LIMIT`; clamp rows/cols to 1..1000.

**L-13. Natural exit never closes the master fd or the group** — Medium (fd growth) / Low (group), CONFIRMED BY READING
- `TerminalRegistry.kt:180-186` (`finally` does `waitFor`, `finish`, removes the session, never `pty.destroy()`). `close()` calls `destroy()` only for sessions still in the map, and an exited one is not.
- Effect 1: the `ParcelFileDescriptor` for the master is closed only when the GC finalizes `PtySession`. On a small heap (D1) many opened/exited terminals accumulate fds.
- Effect 2: background processes left in the dead shell's group are not killed (the pidfile is removed on line 184), so they are untracked by Stop all and the reaper.
- Fix: call `session.pty.destroy()` (or a close-only variant) in the `finally`, and decide explicitly whether to SIGHUP the group.
- Confirm: open and `exit` 50 terminals, then `adb shell ls /proc/<app pid>/fd | wc -l`.

**L-14. `Redactor` misses common secret shapes** — Medium, CONFIRMED BY READING (regex checked)
- `Redactor.kt:21-23` (`\b(password|token|secret|...)\b`).
- `\b` does not match after `_`, so `GITHUB_TOKEN=ghp_…`, `DB_PASSWORD=…`, `AWS_SECRET_ACCESS_KEY=…` are not redacted. JSON `"token": "abc"` and `{"password":"p"}` are not (the quote sits between name and colon). `https://user:pw@host` (URL userinfo) is not. Verified with an equivalent regex in Python: all six forms return no match; only `token=abc` matches. The Share sheet text and the stored crash record pass through this function, and the UI promises "credentials are removed". Path redaction only covers listed top-level dirs.
- Fix: match `[A-Za-z0-9_]*(?:password|passwd|token|secret|api[_-]?key|access[_-]?key)[A-Za-z0-9_]*`, allow an optional closing quote before the separator, redact `//user:pass@`, add known token prefixes (`ghp_`, `github_pat_`, `sk-`, `AKIA…`, `xox[bap]-`) and PEM blocks. Add tests for each.

**L-15. No wake lock, so the CPU can suspend with the screen off** — Medium, SUSPECTED
- No `PowerManager`/`WAKE_LOCK` anywhere in `android/app/src` or the manifest. Plan v8 risk row 7 listed "wake lock"; v9 dropped it without a decision note.
- Scenario: a long build or download runs under the foreground service, the screen turns off, the device is unplugged. A foreground service keeps the process but does not hold the CPU awake, so Doze/suspend stalls child processes and network. `sleep 600` appears fine because timers resume on wake, and the D2 run may have been on USB power.
- Fix: optional partial wake lock while sessions exist (needs `WAKE_LOCK` permission), with a user setting; or document the limitation in the Settings guide.
- Confirm: unplug, screen off 10 min, run `while true; do date >> /sdcard/t.txt; sleep 5; done`, check gaps.

**L-16. `close_range` gating at API 30 is unverified for Android 11-14** — Medium, SUSPECTED
- `pty.c:97-100`, `pty.c:108-115`.
- The gate was chosen after an Android 9 SIGSYS. Whether the app seccomp allowlist contains syscall 436 on Android 11 and 12 (and on kernels older than 5.9 that return ENOSYS, which is fine) was not measured; only D1 (A9) and D2 (A15) were run. If it is missing on some API 30+ builds, the forked child receives SIGSYS before `execve` and every terminal exits immediately with 159 on that device.
- Fix: do not use the syscall at all (loop over `/proc/self/fd` via `getdents64` into a stack buffer, or the bounded `close` loop, ~30-60 ms worst case), or gate on API 34 and verify. Add the check to the test matrix for A11-A14.

### Low

**L-17. `destroy()` sends SIGTERM and SIGKILL back to back** — Low, CONFIRMED BY READING
- `Pty.kt:157-158`. Closing a tab SIGKILLs the group within microseconds, so `git`, `pip` or an editor cannot clean up (stale `.git/index.lock`). Add a 1-2 s grace, or SIGHUP first. Related: `killGroup` falls back to `kill(pid)` (`pty.c:357`); after the pump reaped the child this can hit a recycled pid. Window is tiny; guard with `session.alive`.

**L-18. `resize` can throw on a closed descriptor** — Low, CONFIRMED BY READING
- `Pty.kt:146-149` checks `closed` then calls `descriptor.fd`, which throws `IllegalStateException` if `destroy()` closed it in between. It surfaces as `E_INTERNAL`. Catch it or read the fd int once under a lock.

**L-19. Child path calls non-async-signal-safe libc between `fork` and `exec`** — Low, CONFIRMED BY READING
- `pty.c:97-100` (`android_get_device_api_level` reads a system property), `pty.c:108-115` (`sysconf`), `pty.c:33-41` (`snprintf`/`strerror` in the failure path). In practice bionic handles malloc locks in `fork`, and nothing here allocates, so it works. Cheap to harden: compute the api level and `max` before `fork`, and format the error with a hand-written writer.
- Also: the fallback loop issues up to 65,533 `close` syscalls per terminal (tens of ms through seccomp on D1). Use `/proc/self/fd`.
- Also: a failed `NewIntArray` after fork (`pty.c:221-234`) leaks the child and master. Kotlin's `adoptFd` failure branch (`Pty.kt:88-92`) leaves the child running. Both need OOM, so rare.
- Also: if the app later raises targetSdk to 30+, the raw `close()` loop over fds owned by `ParcelFileDescriptor` trips fdsan in fatal mode. Not a bug at 28.

**L-20. Crash record has no size cap and flows through an Intent and the Share sheet** — Low, CONFIRMED BY READING
- `CrashStore.kt:92-105`, `MainActivity.kt:206-212`, `RecoveryActivity.kt` share. `message` and `stack` are unbounded, but the record is passed as an Intent extra (1 MB Binder limit) and as `EXTRA_TEXT`. A multi-hundred-KB message makes `startActivity` throw in `MainActivity.onCreate`, after `consume()` has already deleted the record. Cap message (~4 KB) and stack (~64 KB) at write time.
- Debug only: `forceCrash` is checked before `consume`, and Android re-delivers the original intent after a crash, so the forced crash can repeat (`MainActivity.kt:197-203`).

**L-21. `term.open` discards the attach snapshot** — Low, CONFIRMED BY READING
- `TermHandler.kt:376-383`. Bytes read between spawn and attach (the first prompt on a loaded device) go to the ring only, and the `term.open` reply carries no scrollback. The first prompt can be missing until the user presses Enter. Include the snapshot in the open reply, or attach before starting the pump.

**L-22. Ring-buffer replay can start mid-sequence, and tiny chunks are memory-heavy** — Low, SUSPECTED
- `RingBuffer.kt`, `TerminalRegistry.kt:36`. The 256 KB tail can begin inside a UTF-8 character or an ANSI escape, and terminal modes set before the window (alt-screen from vim/less, mouse mode) are lost, so reattach during a full-screen app shows garbage. Memory is bounded in bytes, not chunks: one-byte chunks cost roughly 15 MB per session.

**L-23. "0 processes running" notification flashes on every last-session exit** — Low, CONFIRMED BY READING
- `SessionService.kt:75-80`. `satisfyForegroundStart()` posts a real notification with count 0 before `stopForeground(REMOVE)`. Users with channel sounds/heads-up settings may see it blink. Only needed when the service was not yet foreground; use an empty placeholder notification with `setSilent`/no content, or skip when `foregrounded`.

**L-24. Back press is swallowed if the renderer is unresponsive** — Low, SUSPECTED
- `MainActivity.kt:277-296`. The back decision waits for the `evaluateJavascript` callback. If the page hangs, the callback never fires and back does nothing. Add a 300 ms fallback to the default back behaviour.

**L-25. Orphan reaping runs on the main thread in `Application.onCreate`** — Low, CONFIRMED BY READING
- `LeoApp.kt:25`, `OrphanReaper.kt:45` (200 ms sleep per orphan, serial). Ten stale pidfiles add 2 s to cold start. Run it on a background thread; it only needs to finish before the first `term.open`.

**L-26. Release build is signed with the debug key** — Low, CONFIRMED BY READING
- `build.gradle.kts:49` (`signingConfig = debug // phase 0 only`). Not a runtime bug, but any release APK is not updatable from a properly signed build. Needs a decision before the first distributed build.

---

## (a) Claims the code does not support

- `LeoApp` KDoc and the Task 8 text: "if graph construction throws … the next launch opens RecoveryActivity". False (L-02).
- Task 10 / `OrphanReaper` KDoc: "kills process groups left behind by a previous app process", "pid reuse is guarded". Only when the leader is still alive (L-06), and not when the stored start time is 0 (L-07).
- Task 10: "keeps reading while no WebView is attached". True only when detached; an attached but paused WebView applies back-pressure (L-08).
- `TerminalRegistryTest` name "attach to an exited session reports scrollback and the exit code" contradicts its assertion (L-05). `TermAttachReply.alive/exitCode` are effectively dead fields.
- Plan v8 risk row 7 lists a wake lock as a mitigation; nothing implements it and v9 does not record dropping it (L-15).
- PROGRESS.md Task 10 "device-verified": the report itself lists phantom-process killer, low-memory kill and storage pressure as unmeasured. The D2 demo (`sleep 600; echo done`) produces almost no output, so it does not test flow control, wake behaviour or group cleanup. The D1 recreation test used density change, which does not cover the keyboard/font/locale cases (L-10).
- Task 9 "closes every fd above stderr": fds ≥ 65536 are not closed on the fallback path, and the harness T9 scans only fds 3-255 through a separate probe fork (`run_probe`), not the production `createSubprocess`. T6/T8/T9 are still not run on a device.
- Task 8: renderer kill, forced crash and back-order demos, and insets on API 28, are not verified on any device (PROGRESS.md says pending). Landscape insets were not considered (L-11).
- Plan §4.2: "We never start activities from background" is violated by `handleRendererGone` (L-09).

## (b) Important behaviour with no unit test

- `SessionService`: start/stop ordering, count 0, null intent, Stop all.
- `AppGraph.sessionCountChanged` ordering and `serviceActive` transitions.
- `CrashStore`: `install` chaining, `consume` with a corrupt/huge file, `encode/decode`, `shareText`.
- `TerminalRegistry` flow control: `reserve/ack/release`, credit going negative after `beginStreaming`, queue overflow at 512 KB, `close()` while the pump is blocked in `reserve`, `close()` during a blocked write, `detach` between `attach` and `start`, a second `attach` replacing a live listener.
- `TermHandler` (no test file at all): attach reply-before-data ordering, `term.open` snapshot, error mapping.
- `OrphanReaper`: start time 0, pid 1/self, dead leader with live members. `ProcessStartTime.read` (comm containing `)` or spaces). `PidFileStore` write/rename failure.
- `Redactor`: env-style, JSON-style, URL userinfo, prefixed tokens.
- Native `pty.c`: no test of `createSubprocess` errors (bad cwd, execve failure exit 127), `killGroup` guards, `waitFor` signal mapping. Only the debug harness exercises native code.
- `MainActivity`: back dispatcher fallback, renderer-loss window, `onDestroy` detach, notification-permission flow; `RecoveryActivity` restart.

## (c) Checked and found correct

- Foreground service: every `onStartCommand` branch (including null intent) calls `startForeground` before returning; already-foreground services do not need a second call. `startForegroundService` from the background is not restricted below targetSdk 31, matching plan §4.2. Channel creation is API 26+ and minSdk is 28. Stopping via `update(0)` instead of `stopService` fixes the A15 crash.
- Fork/exec: envp copied before fork, no `setenv` after, `execve` failure ends in `_exit(127)`, `setsid` and `TIOCSCTTY` checked, `dup2` checked, the master closed in the child and the slave closed in the parent, master ownership handed to Kotlin only on success, signal mask cleared, all dispositions reset (so SIG_IGN SIGPIPE from the zygote is not inherited), `ptsname_r` buffer of 128 is sufficient, `waitpid` retries on `EINTR`, signal exit mapped to 128+n.
- `close_range` is gated by API level and the fallback loop is bounded (`max` capped at 65536), so a huge `RLIMIT_NOFILE` cannot hang the child.
- App-process SIGCHLD: the zygote handler is not active in app processes (believed, not run), and the code waits on its own pids only.
- PTY EIO on child exit is treated as EOF; read after `destroy()` returns null.
- Registry: snapshot taken under the same lock that gates live delivery, `paused` queue, reply posted before `start()`, so no duplicate or reordered bytes at the attach boundary; ring buffer trimming and oversize writes are correct; `detachAll` does not kill sessions; `sessions.remove(id, session)` avoids double count notification.
- Child environment: `ChildEnv` allowlist; no app secrets reach the PTY.
- CMake: `leocodepty` links with `-Wl,-z,max-page-size=16384`; `python_launcher.c` is not in CMake but is built by `scripts/build-python-launcher.sh` with the same flag and checked by `check-elf-alignment.sh`. Launcher `setenv` runs before `dlopen`, not after a fork.
- `MainActivity`: crash record consumed once; dev URL and `forceCrash` paths are all behind `BuildConfig.DEBUG`; the renderer-gone path removes the dead view before `destroy()` and guards stale views (`view !== webView`); `onRenderProcessGone` returns true; ActivityResult requests are queued per type; the back callback falls through to the default behaviour when JS declines.
- Insets: `Type.navigationBars().bottom` and the IME subtraction are right on API 28-29 (compat uses stable insets) and on API 30+; the IME is reported through insets because `adjustResize` does not resize under `LAYOUT_FULLSCREEN`, which matches the design.
- Theme: `statusBarColor`, light status/navigation flags work at targetSdk 28 on API 28-35.
- `CrashStore.install` chains to the previous handler and swallows write failures (including OOM) with `runCatching`; `AtomicWriter` makes a half-written file impossible; a corrupt crash file is dropped and the launch continues normally.
