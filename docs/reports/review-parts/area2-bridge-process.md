# Bridge router, host transport and process supervision (Phases A-C, Tasks 5-7)

Review of `BridgeRouter`, `BridgeHost`, the handlers, `EventSink`, `ProcessSupervisor`, `ChildEnv`, the generated types and their tests on branch `v9-impl` (HEAD 4389983). Review area 2 of 4. Read-only; nothing was run (no gradle, npm or adb), so every finding is by reading code unless it says otherwise. Findings use the prefix B-.

The router itself is sound. It gives exactly one reply per request, even for double-responding or throwing async handlers, and it redacts `E_INTERNAL`. The problems sit around it. One hostile or buggy message shape crashes the host in `BridgeHost`. `runtime.install` cannot succeed on the web client's default 10 s timeout. The 256 KB inbound cap makes the documented 4 MB writes unreachable, and the failure comes back as a 20 s timeout. `RuntimeHandler` returns raw exception text and app-private paths. Output ordering and process I/O have several races and gaps.

Watch for: (1) B-01 non-primitive `id` throws on the main thread and kills the app (confirmed). (2) B-02 `TerminalRegistry.write` holds the session lock during a blocking PTY write, which can freeze output, ack, resize and close for that session (lock structure confirmed; kernel blocking suspected). (3) B-03 `runtime.install` replies only at the end but the web times it out at 10 s (confirmed). (4) B-04 messages over 256 KB get an `id:null` error the client drops, so large saves and pastes fail silently or after 20 s (confirmed). (5) B-06 raw exception text and paths leave through `RuntimeHandler` (confirmed).

**Verdict**: NEEDS_CHANGES

## High-level view

The router's reply guarantee holds. An atomic flag guards the single reply, async handlers may respond twice or throw after responding, and sync dispatch of an async method fails loudly instead of hanging. The transport in `BridgeHost` is where the guarantee leaks. Parsing the request `id` is outside any try block. Oversize and unparseable messages get replies the client cannot correlate. After the host detaches, nothing re-homes in-flight streams.

Streaming is correct for the terminal's happy path and weak under concurrency. `EventSink` can post two flushes out of order, and the registry replays queued chunks outside its lock while live data can already flow. Process output is not coalesced at all, because `ProcHandler` uses `sink.event` rather than `text`. The 1 MB per-stream cap truncates silently.

`ProcessSupervisor` handles exit-once, UTF-8 splitting and timeout well. Its gaps are an open stdin pipe, silent truncation, count callbacks that can arrive out of order, a sequential 2 s terminate per job, and group-kill behaviour that depends on `/system/bin/setsid` existing.

The error model leaks in one place. `RuntimeHandler` and `RuntimeInstaller` bypass the redaction path. The contract document has drifted from the live reply shapes. Unit coverage is good for the router and supervisor, and absent for `BridgeHost`, `ProcHandler`, `TermHandler` and `RuntimeHandler`.

<details>
<summary>Issues (21)</summary>

1. **B-01 Non-primitive `id` crashes the host** (High, confirmed) - `BridgeHost.str("id")` calls `jsonPrimitive` outside any try; wrap it, or read `id` as an element and stringify only primitives.
2. **B-02 PTY write under session lock** (High, lock confirmed, blocking suspected) - `Session.write` does a blocking `Os.write` inside `synchronized(lock)`; write outside the lock, or make the fd non-blocking.
3. **B-03 `runtime.install` always hits the 10 s client timeout** (High, confirmed) - the host replies only on completion; reply on start (per contract) or disable the timeout for this method.
4. **B-04 256 KB inbound cap vs 4 MB write limits** (Medium, confirmed) - raise the cap for `fs.write`/`saf.save`, or chunk. Reply `E_LIMIT` with the request id by extracting it cheaply, and make the client fail fast on `id:null` errors.
5. **B-05 `EventSink` flush reorder** (Medium, confirmed) - post outside the lock lets two flushes swap. Serialise posting.
6. **B-06 `RuntimeHandler` leaks raw messages and paths** (Medium, confirmed) - map to safe text plus correlation id. Redact the router log line too.
7. **B-07 `proc.run` stdin never closed** (Medium, confirmed) - close `process.outputStream` after start, or redirect from `/dev/null`.
8. **B-08 Process output cap truncates silently** (Medium, confirmed) - emit an `E_LIMIT`-style notice event and make the cap configurable.
9. **B-09 Jobs and installs lose their stream after WebView re-creation** (Medium, confirmed) - nothing re-attaches `proc.*` or `runtime.progress`, so the UI never sees the exit.
10. **B-10 SAF save reports success on write failure; read thread has no catch** (Medium, confirmed) - propagate the failure to the callback and catch in the read thread.
11. **B-11 Registry replays queued chunks outside the lock** (Medium, confirmed) - live data can overtake the replay after `term.attach`.
12. **B-12 Session count callbacks race** (Low-Medium, confirmed) - a stale count can pin the foreground service or notification.
13. **B-13 Terminate blocks and runs sequentially** (Low, confirmed) - `proc.cancel` holds a bridge thread for up to 2 s, `close()` takes up to 2 s per job.
14. **B-14 Group kill depends on `setsid`** (Low, suspected) - without it, SIGTERM reaches only the direct child and grandchildren survive.
15. **B-15 Request `env` can override PATH, LD_LIBRARY_PATH, HOME** (Low, confirmed) - no new privilege, but disallowed keys are dropped silently.
16. **B-16 Unbounded bridge pool, no per-key ordering** (Low-Medium, suspected) - concurrent `term.write` or `fs.write` calls can run out of order.
17. **B-17 Origin ignores port; `io.execute` can throw after detach** (Low, confirmed) - check the port for the asset origin and guard `RejectedExecutionException`.
18. **B-18 Lenient envelope parsing** (Low, confirmed) - non-object `payload` becomes `{}`, `v:"1"` passes, a missing `v` passes.
19. **B-19 Contract drift and default-omitted fields** (Low, confirmed) - `TermOk.ok` and `TermInfo.root` vanish on the wire, and several documented reply shapes differ.
20. **B-20 `term.open` leaks a PTY and can lose first output** (Low, confirmed/suspected) - close the session if attach fails, attach before the pump starts.
21. **B-21 Orphan job if `pidFiles.write` throws** (Low, confirmed) - a started process is never waited on, and its `jobs` entry stays.

</details>

<details>
<summary>Details</summary>

## Host transport: `id` parsing, size limit and reply routing

**B-01 (High, confirmed)** `BridgeHost.kt:143` runs `request.str("id")` on the WebView callback thread (main) before the `io.execute` hand-off. `str` (line 246) is `this[key]?.jsonPrimitive?.contentOrNull`. kotlinx `jsonPrimitive` throws `IllegalStateException` for an object or array. Only the parse is inside `runCatching`, so the exception reaches the framework, the process dies and `RecoveryActivity` opens. Scenario: the page sends `{"v":1,"id":{},"method":"app.ping"}`. Anything in the origin that can post a message can do this (an XSS in a preview pane is enough). Fix: `(request["id"] as? JsonPrimitive)?.contentOrNull`, and reject non-primitive ids with `E_BAD_ENVELOPE`. Related: a numeric `id` is echoed as a number in the reply (router) but as a string in events (`idElement`, line 243), so a numeric-id caller would never match its events. The web always uses strings, so this is latent. Wrapping the whole `onPostMessage` body in `try/catch` would also cover B-17's rejected-execution case.

**B-04 (Medium, confirmed)** `MAX_MESSAGE_BYTES = 256 KB` (BridgeHost.kt:45, checked at 130-135, before parsing and on UTF-8 bytes; correct). The contract promises `fs.write` up to 4 MB and `saf.save` up to 4 MB (`FsHandler.MAX_WRITE_BYTES`, `SafHandler.MAX_WRITE_BYTES`), but a request that large can never arrive. Scenario: the user edits a 300 KB file and saves. `AndroidBridge.write` sends the whole content (`android.ts:239`). The host answers `sendError(replyProxy, null, "E_LIMIT", ...)`, whose `id` is `null`. The client's `receive` drops replies without an id (`android.ts:205`), so the promise waits for the 20 s write timeout and rejects with `E_TIMEOUT` ("fs.write timed out"). The user sees a misleading error and the file is not saved. The same applies to a terminal paste above about 190 KB: `term.write` base64 grows past 256 KB, the error is swallowed by `.catch(() => {})` (`android.ts:321`, `364`), and the paste vanishes. The 4 MB figure and the unit tests exercise `FsHandler` directly, so no test shows the gap. Fix: pick one limit story. Either raise the transport cap per method (parse a small prefix to find `id` and `method`), or add chunked write and have the client check size before sending. At minimum, extract `id` with a bounded scan so `E_LIMIT` carries it, and have the client reject immediately.

**B-17 (Low, confirmed)** `isOriginAllowed` accepts `https://appassets.androidplatform.net` on any port (BridgeHost.kt:55-57); only the debug branch looks at the port. Listener registration (`allowedOrigins`) is the first gate and uses exact origin strings, so this is defence in depth only. `onPostMessage` calls `io.execute` (line 144); after `detach()` or `close()` the pool is shut down and a late message throws `RejectedExecutionException` on the main thread. The window is small because the WebView is destroyed right after, but a try/catch costs nothing.

**B-18 (Low, confirmed)** `BridgeRouter.dispatchAsync` uses `(request["payload"] as? JsonObject) ?: JsonObject(emptyMap())` (line 86), so an array or string payload becomes `{}` and fails later with a misleading "id is required" or similar. `validate` (line 126) uses `intOrNull` on a primitive, so `"v":"1"` passes, and a missing `v` passes too. Contract says "rejects any v it does not serve". Return `E_BAD_ENVELOPE` for a non-object payload and decide explicitly about a missing `v`.

## Router guarantee and error redaction

**B-06 (Medium, confirmed)** `RuntimeHandler.kt:111-116`. `RuntimeInstallException` messages are forwarded verbatim, and `RuntimeInstaller` builds them from absolute app-private paths (`destination.path` line 352, `prefix.path` lines 568 and 573), archive entry names (394, 398, 419), and `${e.message}` of network exceptions (224, 231, 438, 535). The generic branch returns `e.message ?: e.javaClass.simpleName`, so any other throwable puts its text, or a class name, on the wire. Neither path produces a correlation id, and the codes `E_BAD_MANIFEST`, `E_INTEGRITY` and `E_HEALTH_CHECK` collapse to `E_INTERNAL` through `fromCode` while keeping the raw text. This breaks contract "Errors are safe" and plan 7.4. Scenario: extraction fails on a full disk and the sheet shows `cannot create /data/user/0/dev.leocode/files/...`. Fix: map installer codes to fixed user messages, log the detail with a correlation id, and return the generic message for unknown throwables. Also: `BridgeRouter.kt:120` logs `${e.javaClass.name}: ${e.message}` through the plain `Log.w` supplied in `MainActivity` without `Redactor`, whereas plan 7.5 says logs are redacted.

## Streaming, `EventSink` and the terminal credit window

**B-05 (Medium, confirmed)** `EventSink.flush()` (lines 242-261) collects the batch inside the lock and posts after releasing it. Callers include the scheduler thread (timer), the producing thread (`flushNow` at 32 KB) and `WebViewStreamSink.event` (flush before an event). Two concurrent flushes can post their batches in the wrong order. Scenario under a `yes` flood: the timer collects chunk X and is about to post; the pump appends Y, crosses 32 KB, flushes on its own thread and posts Y first. The terminal receives Y before X and escape sequences corrupt. The same race lets `term.exit` or `proc.exit` overtake the last data event, after which `TerminalChannel.receiveExit` marks the channel closed and drops any data that arrives later (`TerminalChannel.receive`, `finish` sets `closed`). Fix: hold a separate post lock acquired before releasing `lock`, or funnel posts through one single-thread executor. No test covers concurrent flush; `EventSinkTest` calls `flush()` by hand.

Pending-buffer drops are counted in `dropped` but nothing reads `droppedBytes` (grep finds only the declaration). In practice the cap is hard to hit because producers flush inline, but when it is hit the loss is silent and never signalled, which for the terminal means corrupted output rather than an error.

**B-08 (Medium, confirmed)** `ProcHandler.kt:67-84` emits stdout, stderr and exit with `sink.event(...)`, not `sink.text(...)`. `WebViewStreamSink.event` flushes the coalescer and posts immediately (BridgeHost.kt:186-189), so `proc.stdout` is not coalesced at 16 ms, contrary to the contract and the Task 6 claim. Each 8K-char read becomes one bridge message. Separately, `StreamPump` stops emitting after `maxOutputBytes` (default 1 MiB per stream; not settable from the request, `ProcHandler.kt:57-62`) and silently discards the rest (`ProcessSupervisor.kt:205`, `212`). A long-running server or a chatty script goes quiet after 1 MB with no notice, though the process keeps running. Fix: emit one final "output truncated" event or `E_LIMIT` signal, and route output through `sink.text` so it is coalesced.

**B-11 (Medium, confirmed)** `TerminalRegistry.Session.beginStreaming` (lines 234-259) sets `paused = false` under the lock, then delivers the queued `chunks` after leaving it. The pump thread's `received()` takes the lock, sees `paused == false`, and calls `target.data` directly, so live output can reach the web before the replay of queued chunks finishes. Scenario: `term.attach` while `yes` is running. Output is reordered at the seam. Fix: deliver queued chunks while still holding the lock, or keep `paused` set until the replay is done. Also note `received()` drops chunks silently when `queuedBytes + size > 512 KB` while paused (ring still has them); acceptable, but unsignalled.

An ack for a session that just exited returns `E_NOT_FOUND` (the client discards it). A duplicate ack only inflates credit up to the 4 MB clamp.

**B-02 (High, lock structure confirmed; kernel behaviour suspected)** `TerminalRegistry.kt:320-322`: `write` is `synchronized(lock) { pty.write(bytes) }`, and `PtySession.write` is a plain blocking `Os.write` on the master fd. The same lock is taken by `reserve`, `received`, `ack`, `resize`, `finish`, `close` and `detach`. Scenario: the user runs `sleep 1000` and pastes 100 KB. The slave's input queue fills (a few KB), the write blocks while holding the lock. The reader thread cannot take the lock, so output stops and the child's own writes stall. `term.close` and "Stop all" block on the same lock, so they cannot kill the child that would free the writer. Each blocked request pins a bridge thread (the pool is unbounded). To confirm: on D1 or D2 start a terminal, run `sleep 1000`, paste more than 64 KB, then press close. If the tty queue absorbs it, the hang does not reproduce. Fix: copy-and-write outside the lock (check `alive` under it first), or use a per-session writer thread with a bounded queue.

**B-20 (Low)** `TermHandler.openSession` (lines 121-129): `registry.open` starts the pump thread before `registry.attach`. Output produced in that gap goes to the ring only; `term.open` returns no scrollback, so the web never sees it (suspected, narrow window; a shell's first prompt usually takes longer). If `attach` returns null, the freshly spawned PTY is never closed (confirmed by reading; practically unreachable).

**B-16 (Low-Medium, suspected)** `BridgeHost.io` is `newCachedThreadPool`, so every message gets a thread with no bound, and two requests for the same session or file can run concurrently in either order. Examples: two quick `term.write` calls swapping keystrokes, or two `fs.write` calls to one path where the older lands last. The web mostly serialises (one `term.write` per animation frame), so reordering needs two messages in flight close together. Plan Task 5 specifies a bounded IO dispatcher. A loop in the page can create unbounded threads. Fix: bounded pool plus a per-session/per-path serial executor.

## `ProcessSupervisor` and `proc.*`

**B-07 (Medium, confirmed)** `ProcessSupervisor.start` never writes to or closes `process.outputStream` (lines 60-76). The child's stdin is an open pipe, so anything that reads stdin (`python -` , `cat`, `input()`) blocks forever, and with the default `timeoutMs = 0` (`ProcHandler.kt:29`, `61`) it never ends. `proc.cancel` still works. Fix: close the stream right after start (EOF), or redirect input from `/dev/null`.

**B-09 (Medium, confirmed)** Event sinks are bound to the `JavaScriptReplyProxy` of the request that started them (`WebViewStreamSink`). `AppGraph.procHandler` and `runtimeHandler` are process-wide singletons, and `MainActivity.onDestroy`/`handleRendererGone` call `graph.detachBridge()`, which only detaches terminals. A running `proc.run` job keeps going, its events go to the dead proxy (caught and logged at debug), and the new page has no `proc.attach` equivalent and no way to list jobs. The Run panel stays in "running" forever and the job still counts in the notification. The same holds for a `runtime.install` (progress and final reply are lost; a re-issued install returns `E_BUSY` until the old one finishes, with no way to observe it). Fix: a job registry with attach/list like terminals, or cancel jobs on detach.

**B-12 (Low-Medium, confirmed)** `ProcessSupervisor.notifyCount` evaluates `jobs.size` and then calls the callback (lines 132-134); `AppGraph.sessionCountChanged` applies the value under `countLock`. Two threads (start on a bridge thread, exit on a wait thread) can read sizes 2 then 1 and apply 1 then 2, leaving a stale count. Result: a phantom notification, or a foreground service that never stops. Same pattern in `TerminalRegistry.notifyCount` (line 154). Fix: compute the size inside the same lock that applies it.

**B-13 (Low, confirmed)** `terminate` blocks up to 2 s (line 146). `proc.cancel` runs it on a bridge thread, so the reply is delayed that long (within the 10 s client timeout). `close()` terminates jobs one after another (lines 124-128): N jobs that ignore SIGTERM take 2N seconds. `SessionService` runs it off the main thread, so no ANR, but "Stop all" is slow with many jobs. Also `cancel` can find a job whose process has already exited but whose pumps are still draining (join waits up to 2 s per pump); `terminate` then signals a pid that may already be reaped. Skip the signal when `process.isAlive` is false. Pid reuse risk is theoretical.

**B-14 (Low, suspected)** Group kill relies on `/system/bin/setsid` (line 245), which makes the child a group leader. Without it, `killGroup` falls to `kill(pid)` (pty.c:352-358) and only the direct child dies. `sh -c "python app.py"` leaves python running, holding the pipes, so exit reporting waits on the 2 s joins and the job lingers. With `setsid` present, a missing binary yields a child that exits 127 with the message on stderr, whereas without it `start` throws and the host returns `E_IO`. Behaviour therefore differs by device. To confirm: `adb shell ls -l /system/bin/setsid` on D1 (Android 9) and D2, and run `proc.cancel` on `sh -c "sleep 100 & wait"`. Pid discovery on Android 9 uses reflection on a hidden `pid` field (`pidOf`); if that fails the pid is -1 and the group kill is skipped entirely. Not verifiable here.

**B-15 (Low, confirmed)** `ChildEnv.build(base, extra)` lets the request override any allowlisted key, including `PATH`, `LD_LIBRARY_PATH`, `HOME`, `PYTHONHOME` and `SSL_CERT_FILE` (ChildEnv.kt:282-284). Since `proc.run` already runs arbitrary argv, this adds little, but keys outside the allowlist (for example `PYTHONUNBUFFERED`, `PYTHONPATH`) are dropped without any signal, which will confuse a caller who sets them. The web does not send `env` today. Python launched through `proc.run` therefore has block-buffered stdout when piped (`runStore.ts:161` runs `["python3", name]` with no `-u`); the Python launcher may set it itself, which I did not check, so this is likely rather than confirmed.

**B-21 (Low, confirmed)** In `start`, `jobs[jobId] = job` and `pidFiles?.write` (lines 74-75) run before the pump and wait threads exist. An exception from `pidFiles.write` leaves a running process with no wait thread, never reaped, with a stale `jobs` entry. `ProcHandler` reports `E_IO` "cannot start" for a process that did start.

`ProcExit` carries only `code`; the contract lists an optional `signal`. A timeout reports `-1`, a cancel reports 143 (128+15), so the UI cannot tell them apart from a real exit code.

## Reply ordering for `proc.run`

For `proc.run`, a fast child's events can be queued before the `proc.run` reply, because the handler returns after `start` and the reply is posted afterwards. The web client registers the stream handler at send time, so this is safe there (`android.ts:268`). `term.open`/`term.attach` explicitly reply before `start()`, which matches the contract.

## SAF replies and the Activity side

**B-10 (Medium, confirmed)** `MainActivity.kt` `saveLauncher` (around line 158): the write is wrapped in `runCatching`, and the callback gets `uri.toString()` regardless of whether the write succeeded. A failed write (revoked URI, disk full, provider error) reports success, and the user believes the file was exported. In `openLauncher` the read runs on a bare `thread { ... }` with no try/catch (around line 136). `contentResolver.openInputStream(...).read` can throw `IOException` or `SecurityException`, which kills the process through the default handler, and the request never gets its reply. `readUriContent` returns `""` when `openInputStream` returns null, so a failure looks like an empty file. Binary files are decoded lossy. Fix: report failures as `E_IO`/`E_PERMISSION` through the callback. The save also writes up to 4 MB on the main thread. The "SAF requests keyed by request id" claim is not what the code does; it is a FIFO queue with a single in-flight slot (lines 121-129), which works but is the pattern the plan said to avoid.

## Contract, generated types and origin

**B-19 (Low, confirmed)** `Json { ignoreUnknownKeys = true }` has `encodeDefaults = false`, so default-valued fields disappear from the wire. In `Contract.kt`: `TermOk.ok = true` (line 139) means `term.resize` and `term.ack` reply `{}` where the contract says `{ ok }`; `TermInfo.root = false` (line 161) is omitted from `term.list`; `AppInfo.androidSdk/androidRelease/abi/webview/workspace` are omitted when equal to their defaults; `BridgeReply.v/ok` defaults are unused since the router builds replies by hand. The generator marks such fields optional (`ok?`, `root?`), so the TS types are honest, and the web does not read them today. `PingReply.pong` was fixed by removing its default. Documentation drift: `proc.cancel` returns `{cancelled}` (doc: `{}`), `app.ping` returns `{pong}`, `fs.read` returns `{path, content, size}` (doc: `{content, nextOffset, mtime, hash}`), `fs.write` returns `{path, size}` (doc: `{mtime, hash}`), `term.open` ignores a `root` field without error, and `runtime.install` is documented as "reply on start within 10 s" but replies at the end (the cause of B-03).

**B-03 (High, confirmed)** `RuntimeHandler.install` calls `respond` only after `installer.install` finishes (RuntimeHandler.kt:84-123). The web client's `runtime.install` is not in `USER_WAIT_METHODS`, so `defaultTimeoutMs` returns `FAST_TIMEOUT_MS = 10 s` (`timeouts.ts:30-34`), and `RuntimeManager.startInstall` (line 292) passes no override. Any install longer than 10 s (download plus extract plus pip bootstrap on D1) rejects with `E_TIMEOUT`, deletes the stream handler (progress stops), shows an install error, and the install keeps running on the host. Retrying returns `E_BUSY`. Fix: either reply immediately with `{id}` and send completion as an event (matches the contract), or pass `timeoutMs: null` for this method and update the contract.

## Claims versus code

PROGRESS.md and the plan say: SAF and permission callbacks are "keyed by unique request code" (actually a FIFO with one slot); `EventSink` coalesces output at 16 ms (not for `proc.*`, see B-08); handlers never leak raw exception text (false for `RuntimeHandler`); `E_INTERNAL` details go to a redacted log (the router log line is unredacted); Task 5 asks for a bounded IO dispatcher with a `SupervisorJob` (the host uses an unbounded cached pool); `onExit` runs "after both pumps have finished" (joins time out after 2 s each, so output from a surviving grandchild can arrive after `proc.exit`). Task 6 device verification is already marked open in PROGRESS.md.

</details>

<details>
<summary>Coverage notes</summary>

**Behaviours with no unit test:** everything in `BridgeHost` except origin matching (size limit, `id` handling, reply posting, detach); `WebViewStreamSink`; `ProcHandler` (argv validation, cwd jail, env filtering, error mapping); `TermHandler` (open/attach reply-before-stream ordering, base64 errors, ack validation); `RuntimeHandler` (E_BUSY, cancel, error mapping); `AppHandler` theme set; `EventSink` timer flush and concurrent flush; `ProcessSupervisor` native group kill, `setsid`, stdin, pid discovery and the 2 s join; router tests for numeric or object `id`, `v` variants, non-object payload, handler that throws after responding; origin checks with ports on the asset origin.

**Checked and correct:** one-reply guard (atomic flag; double respond, throw after respond and sync dispatch of an async method all behave); duplicate method registration rejected; size limit enforced on UTF-8 bytes before parsing, and parse errors including stack overflow are caught; `ErrorCode` enum matches all 24 codes in the contract table, and `types.gen.ts` matches `Contract.kt` field by field; every payload the web sends (`fs.*`, `proc.run`, `term.*`, `saf.*`, `runtime.*`) fits its DTO; `E_INTERNAL` from the router is redacted with a correlation id; `BridgeException` messages at the throw sites I read carry no paths or class names; byte chunks are concatenated before base64 so no split mid-character in base64, and `StreamPump` decodes through an `InputStreamReader` and truncates on code-point boundaries; exit callback fires once; `EventSink` uses one static daemon scheduler, so there is no per-sink timer leak, and `close()` flushes; term credit clamps, negative ack rejected, readers wake on close; release builds ignore `devUrl` and dev origins; runtime progress is throttled (120 ms download, 250 ms extract); `runtime.cancel` is idempotent.

</details>

## File map

<details>
<summary>Files reviewed</summary>

- `bridge/BridgeRouter.kt`: envelope validation, dispatch, one-reply guard
- `bridge/Envelope.kt`, `BridgeException.kt`, `ErrorCode.kt`, `BridgeHandler.kt`, `AsyncBridgeHandler.kt`, `StreamSink.kt`: handler contracts and DTOs
- `bridge/EventSink.kt`: 16 ms coalescing with pending cap (B-05)
- `bridge/ProcHandler.kt`, `TermHandler.kt`, `SafHandler.kt`, `RuntimeHandler.kt`, `AppHandler.kt`: domain handlers
- `bridge/Contract.kt`, `BridgeTypesGenerator.kt`, `web/src/bridge/types.gen.ts`, `types.ts`: wire DTOs and generated types
- `BridgeHost.kt`, `AppGraph.kt`: transport and wiring
- `core/ProcessSupervisor.kt`, `ChildEnv.kt`: process launch and environment
- `core/TerminalRegistry.kt`, `core/Pty.kt`, `MainActivity.kt` (SAF section), `web/src/bridge/android.ts`, `timeouts.ts`: read for call-site behaviour
- Tests: `BridgeRouterTest`, `EventSinkTest`, `ProcessSupervisorTest`, `ChildEnvTest`, `BridgeHostOriginTest`

Full diff: `git diff 542e14e..HEAD -- android/app/src web/src/bridge`

</details>
