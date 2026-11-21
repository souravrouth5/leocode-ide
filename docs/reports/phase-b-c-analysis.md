# Phase B and C analysis report: bugs and edge cases (Tasks 4–13)

**Date:** 2026-11-14 · **Branch:** `v9-impl` at `4389983` · **Scope:** `git diff 542e14e..HEAD` (169 files, +15 001 / −5 399), plan v9 Tasks 4–13
**Audience:** the next AI model or person who will fix these before Phase D and the Python phase start. This file is self-contained. The four detailed reviews it is built from are in [`review-parts/`](review-parts/).

---

## 1. Verdict

**Not ready to build on.** The architecture is sound: the router gives exactly one reply per request, the path jail is applied to every path-taking method, the error catalog covers all 24 codes, and the native fork/exec path is correct. The problems are in what surrounds those pieces. Nine of them are rated High, and several of those destroy user data or take the app down.

| Severity | Count (as reported) | Distinct after merging duplicates |
|---|---|---|
| High | 11 | 9 |
| Medium | 58 | ~56 |
| Low | 36 | ~36 |
| **Total** | **105** | **~100** |

Four findings were reported by two reviewers each: `runtime.install` timeout (B-03 = W-01), PTY write under the session lock (B-02 = L-04), SAF failure handling (S-10 + S-11 = B-10), and the session-count race (B-12 ≈ L-03).

### How this report was made

- **Method:** four read-only reviews, one per area (security and files, bridge and process, lifecycle and native, web). Each read the code and the plan, and tagged every finding CONFIRMED BY READING or SUSPECTED, with the device check that would settle it.
- **No build, test or device run is part of the findings.** I ran the web checks (typecheck, lint, 57 tests, build) and they pass. I tried an Android Gradle run, but it did not complete, so I have **no Android unit-test result of my own**, and nothing here depends on one. A figure of 108 unit tests that appeared in my terminal came from stale result files and should not be cited.
- **I re-read the code myself for the most serious items:** S-01 (trash purge), B-01 (`id` parse), L-01 (`kill(-1)`), W-01 (`runtime.install` timeout) and W-02 (save race). All five hold as described.
- **Line numbers are approximate.** One reviewer line number was wrong (the trash `purge()` call is at `FsHandler.kt:163`, not 138). Search by symbol name, not by line.
- **Phones:** neither was reachable during this review, so every device-dependent item is SUSPECTED until checked (Section 7).

---

## 2. Fix first (priority 1)

Each of these loses data, crashes the app, or makes a documented feature unusable.

### P1-1 · Trash purge permanently deletes old files (S-01) — CONFIRMED
`Trash.move` uses `renameTo`, which keeps the file's old modification time. `Trash.purge` decides age from `lastModified()` (`core/Trash.kt`, `purge`), and `FsHandler.delete` calls `purge()` before every move (`FsHandler.kt:163`).
- **Scenario:** delete `notes.txt` (last edited 45 days ago). It lands in the trash with a 45-day-old time. Delete anything else a minute later: `purge` runs first and removes `notes.txt` for good.
- **Why it matters:** the docs and the `Trash` comment say nothing is deleted permanently by the bridge. `TrashTest` sets times by hand, so it never runs move-then-purge.
- **Fix:** the entry name already starts with the trash time (`$now-uuid-name`). Purge on that value, or call `setLastModified(now)` after the move. Treat a negative age as "keep". Add a test that deletes an old file and then purges.

### P1-2 · Deleting the shared trash folder recurses into itself (S-02) — CONFIRMED BY READING
`/sdcard/.leocode-trash` is visible, inside the jail and not protected. Deleting it picks the trash itself as the destination, the rename fails, and the copy fallback copies the folder into the copy it is creating.
- **Fix:** add both trash folders to the protected set, hide `.leocode-trash` from `fs.list`, and make `Trash.move` refuse a destination under its source.

### P1-3 · A malformed request `id` crashes the app (B-01) — CONFIRMED
`BridgeHost.onPostMessage` calls `request.str("id")`, which uses `jsonPrimitive`, on the main thread and outside any try. `{"v":1,"id":{},"method":"app.ping"}` throws `IllegalStateException` and the process dies into `RecoveryActivity`.
- **Fix:** read `id` as `(request["id"] as? JsonPrimitive)?.contentOrNull`, reject non-primitive ids with `E_BAD_ENVELOPE`, and wrap the whole handler body in a try/catch (this also covers a `RejectedExecutionException` after detach, B-17).

### P1-4 · `killGroup` can signal every process (L-01) — CONFIRMED
`pty.c killGroup` only rejects `pid <= 0`. A pidfile with pid 1 and start time 0 makes `OrphanReaper` call `kill(-1, SIGTERM)`, which reaches every process the app uid may signal, including the app itself. The same applies to the app's own pid or process group.
- **Fix:** reject `pid <= 1`, `getpid()`, `getpgrp()` and anything above `pid_max`, both in `killGroup` and in `OrphanReaper` before the call. Test pids 0, 1, own pid, own group.

### P1-5 · A startup exception makes the crash screen unreachable (L-02) — CONFIRMED BY READING
`LeoApp.onCreate` builds the graph and calls `workspace.ensure()` without a guard. If that throws (disk full, a dangling symlink at `usr`), it throws again on every launch before `MainActivity` can show `RecoveryActivity`. The user gets "app keeps stopping" until they clear data. The `LeoApp` comment says recovery handles this; it cannot.
- **Fix:** make the graph lazy, catch the failure in `onCreate`, and let `MainActivity` open `RecoveryActivity` when a startup error is stored.

### P1-6 · `runtime.install` always fails after 10 seconds (B-03 = W-01) — CONFIRMED
The host replies only when the install finishes (`RuntimeHandler.install`). The web client gives `runtime.install` the default 10 s timeout (`timeouts.ts`), and `timeouts.test.ts` asserts that value. A real install takes longer, so the user sees an error while the host keeps installing, progress stops, and a retry returns `E_BUSY`.
- **Fix:** either make the host reply on start and report completion as an event (matches the contract), or give `runtime.install` `timeoutMs: null` and fix the contract and the test. Do this before the Python tasks, which depend on it.

### P1-7 · Save marks newer text as saved (W-02) — CONFIRMED
`editorStore.save` writes `doc.content`, awaits, then sets `saved: item.content` (the content at completion, not what was written). Text typed during the write shows as clean, and closing the tab gives no discard prompt.
- **Fix:** `saved: doc.content`.

### P1-8 · New file and Save As silently overwrite (W-03, W-04) — CONFIRMED
"New file" calls `bridge.write(path, "")` and "Save As" writes to the typed path. `fs.write` always overwrites, so an existing file is truncated or replaced. The `E_EXISTS` inline error described in the contract is never produced. Save As also does not check whether the target is already open in another tab.
- **Fix:** add a create-new option to `fs.write`, or list first. Ask before replacing.

### P1-9 · Terminal write holds the session lock (B-02 = L-04) — lock CONFIRMED, blocking SUSPECTED
`Session.write` does a blocking `Os.write` on the PTY master inside `synchronized(lock)`. The same lock guards output delivery, `ack`, resize, attach and close. If the child stops reading input (`sleep 1000` then a 100 KB paste), output stops and the session cannot be closed from the UI, because close waits for the same lock.
- **Fix:** check `alive` under the lock, then write outside it, or use a per-session writer with a bounded queue.
- **Confirm:** on a phone, run `sleep 1000` in a terminal, paste more than 64 KB, then close the tab.

### P1-10 · A failing SAF read crashes the app; a failing SAF save reports success (S-10, S-11, B-10) — CONFIRMED
The SAF read runs on a bare `thread {}` with no catch, so a revoked or offline document kills the process and the request never gets a reply. The save ignores the write result and returns the URI, so a full disk looks like a successful export.
- **Fix:** catch both, reply `E_IO` or `E_PERMISSION`, and stop reporting success for failed writes.

### P1-11 · Messages over 256 KB fail as a 20 s timeout (B-04) — CONFIRMED
The transport cap is 256 KB, but the contract allows 4 MB for `fs.write` and `saf.save`. The oversize reply carries `id: null`, which the client drops, so saving a 300 KB file waits 20 s and fails as `E_TIMEOUT`. Terminal pastes above about 190 KB vanish (base64 growth, error swallowed).
- **Fix:** decide one limit story (per-method caps or chunked write), reply `E_LIMIT` with the real request id, and have the client fail fast.

---

## 3. Themes that explain many findings

1. **Locks held across blocking work, and posts outside locks.** B-02/L-04 (PTY write under lock), B-05 (event flush reordering), B-11 (replay outside the lock), B-12/L-03 (count callbacks out of order). One review of the concurrency in `TerminalRegistry`, `EventSink`, `ProcessSupervisor` and `AppGraph` would catch the whole family.
2. **The web and host disagree on contract details.** `runtime.install` timing, the documented `fs.read` chunking that does not exist, reply shapes (`proc.cancel`, `fs.write`, `fs.read`), default-valued fields dropped on the wire (`TermOk.ok`, `TermInfo.root`), and the 256 KB cap against 4 MB writes. Fix the code or the contract, and add a test that sends a real message through `BridgeHost`; none exists today.
3. **Failures that look like success, or like something else.** SAF save success on failure (B-10), `E_LIMIT` becoming a timeout (B-04), a failed attach starting a second shell (W-22), swallowed `term.write` errors (W-23), `RuntimeHandler` returning raw exception text and app paths (B-06). The plan's rule is that nothing fails silently.
4. **State that is cleared or replaced too early.** Dirty flag cleared for unwritten text (W-02), exited terminals removed before the web can read their exit code (L-05), the Python probe cached forever (W-13), session restore that replaces newer tabs (W-26), the old run's output leaking into a new run (W-14).
5. **Unreachable features claimed as done.** `E_BRIDGE_DISCONNECTED` is never raised (W-07), conflict detection and the "Reload / Keep mine" banner do not exist (W-05, W-06), the storage-permission flow cannot be started from the UI (W-27), redaction is not implemented on either side (L-14, W-09), snackbar undo is unused.

---

## 4. Full register

Severity: **H** high, **M** medium, **L** low. "Conf." is C for confirmed by reading and S for suspected. Details, scenarios and device checks for each ID are in the matching file under [`review-parts/`](review-parts/).

### 4.1 Security and files — [`area1-security-files.md`](review-parts/area1-security-files.md)

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| S-01 | H | C | Trash purge keys on the original mtime and deletes old files at the next delete | Purge on the embedded trash time |
| S-02 | H | C | Deleting `.leocode-trash` moves it into itself and recurses | Protect and hide the trash folders |
| S-03 | M | C | `fs.read` on a FIFO blocks a bridge thread forever | Reject non-regular files |
| S-04 | M | S | `rel()` may return absolute paths because `/data/user/0` canonicalises to `/data/data` | Canonicalise the root in `rel()` |
| S-05 | M | C | `fs.delete` and `fs.rename` act on a symlink's target; outside links cannot be removed | Resolve the parent, keep the last name unresolved |
| S-06 | M | C | Trash entry name adds 51 characters, so names over about 204 bytes cannot be deleted | Truncate the stored name |
| S-07 | M | C | `AtomicWriter` drops file permissions, so saving removes `+x` | Copy permissions to the temp file |
| S-08 | M | C | Invalid UTF-8 is silently replaced on read, so a save corrupts the file | Strict decode, return `E_BINARY` |
| S-09 | M | C | Write limit 4 MB, read limit 2 MB; chunked read in the contract is not implemented | Align limits or implement chunking |
| S-10 | M | C | SAF read thread has no exception handling and can crash the app | Catch, reply `E_IO` |
| S-11 | M | C | SAF save returns the URI even when the write failed | Report the failure |
| S-12 | M | S | Case-only rename fails on case-insensitive shared storage | Allow when both resolve to one inode |
| S-13 | M | C | `workspaces/default` can be renamed, leaving no workspace | Protect it as delete does |
| S-14 | L | C | Check-then-act windows in rename and write; `renameTo` replaces empty directories | Note; low risk against the WebView threat model |
| S-15 | L | C | No directory fsync in `AtomicWriter`; "crash-safe" holds for process death only | fsync the directory or reword |
| S-16 | L | C | Leftover `.tmp` files are visible and never cleaned | Sweep on start; hide in `fs.list` |
| S-17 | L | C | SAF open returns binary as garbage text with no `E_BINARY` | Add the NUL/strict check |
| S-18 | L | C | Purge runs synchronously on every delete | Run off the request path |
| S-19 | L | C | Debug builds expose the bridge to `localhost:5173` and the `devUrl` extra | Debug only; document |
| S-20 | L | C | Meta CSP `frame-ancestors` is ignored; no total-size cap on extraction | Remove or move to a header; add a cap in Task 25 |

### 4.2 Bridge and process — [`area2-bridge-process.md`](review-parts/area2-bridge-process.md)

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| B-01 | H | C | Non-primitive `id` throws on the main thread and crashes the app | Safe id parse plus a top-level try/catch |
| B-02 | H | C/S | PTY write under the session lock (same as L-04) | Write outside the lock |
| B-03 | H | C | `runtime.install` replies at the end but times out at 10 s (same as W-01) | Reply on start or disable the timeout |
| B-04 | M | C | 256 KB cap makes 4 MB writes unreachable; the `E_LIMIT` reply has `id:null` | One limit story; reply with the id |
| B-05 | M | C | `EventSink.flush` posts outside its lock; flushes can swap, `term.exit` can overtake data | Serialise posting |
| B-06 | M | C | `RuntimeHandler` returns raw exception text and app paths; router log is unredacted | Fixed messages plus a correlation id |
| B-07 | M | C | `proc.run` never closes the child's stdin | Redirect input from `/dev/null` |
| B-08 | M | C | `proc.*` output is not coalesced; the 1 MB cap truncates silently | Use `sink.text`; send a truncation notice |
| B-09 | M | C | After the WebView is rebuilt, jobs and installs have no re-attach path | Job registry with attach/list, or cancel on detach |
| B-10 | M | C | SAF save success on failure; read thread has no catch (same as S-10/S-11) | See S-10 |
| B-11 | M | C | Queued chunks replay outside the lock, so live data can overtake them | Replay under the lock |
| B-12 | L–M | C | Session-count callbacks can arrive out of order (see L-03) | Apply the count inside one lock |
| B-13 | L | C | `terminate` blocks up to 2 s per job, one after another | Signal all, then wait once |
| B-14 | L | S | Group kill depends on `/system/bin/setsid` existing | Verify on both phones |
| B-15 | L | C | Request `env` can override PATH and `LD_*`; disallowed keys are dropped silently | Report dropped keys |
| B-16 | L–M | S | Unbounded bridge thread pool, no per-session or per-path ordering | Bounded pool plus serial executors |
| B-17 | L | C | Asset origin check ignores the port; `io.execute` can throw after detach | Check the port; guard the call |
| B-18 | L | C | Lenient envelope: non-object payload becomes `{}`, `v:"1"` and a missing `v` pass | Validate strictly |
| B-19 | L | C | Default-valued fields vanish on the wire; several documented reply shapes differ from the code | Align the contract and the DTOs |
| B-20 | L | C/S | `term.open` can leak a PTY and drop first output | Attach before the pump starts |
| B-21 | L | C | A throw in `pidFiles.write` leaves a running process with no wait thread | Start the pumps first, or clean up |

### 4.3 Lifecycle and native — [`area3-lifecycle-native.md`](review-parts/area3-lifecycle-native.md)

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| L-01 | H | C | `killGroup` can send `kill(-1)` for pid 1, own pid or own group | Guard pid ≤ 1, self, own group |
| L-02 | H | C | `LeoApp.onCreate` failure repeats on every launch before recovery can open | Lazy graph, catch, route to recovery |
| L-03 | M | S | Service start/stop ordering can drop the foreground service while jobs run, or pin a stale notification | `stopSelf(startId)`; read the count from the graph |
| L-04 | M | C/S | Same as B-02 | See B-02 |
| L-05 | M | C | Exited sessions are removed at once, so exit code and scrollback are unreachable; a test named for that case asserts `null` | Keep exited sessions until closed |
| L-06 | M | S | Reaper ignores an orphan group whose leader already exited | Scan `/proc` for group members |
| L-07 | M | C | A stored start time of 0 skips the pid-reuse check | Do not write or trust a zero start time; store the boot id |
| L-08 | M | S | A backgrounded terminal stalls once 256 KB is unacknowledged | Detach the listener in `onStop` |
| L-09 | M | S | Renderer loss in the background: immediate rebuild, then a blocked `startActivity`, then `finish()` | Defer to `onResume`; persist loss times |
| L-10 | M | S | `configChanges` omits keyboard, font scale, locale, density; those changes reload the WebView | Add the flags or autosave first |
| L-11 | M | S | Only top and bottom insets reach the page; landscape and notch cases are uncovered | Publish left/right and cutout insets |
| L-12 | M | C | No cap on terminal sessions; rows and cols not range-checked | Limit to about 8; clamp 1..1000 |
| L-13 | M | C | A naturally exited session never closes its master fd; background children are untracked | `destroy()` in the pump's `finally` |
| L-14 | M | C | `Redactor` misses `GITHUB_TOKEN=…`, `DB_PASSWORD=…`, JSON `"token":`, `user:pw@host` | Wider pattern, URL user-info, token prefixes, tests |
| L-15 | M | S | No wake lock; the CPU can suspend with the screen off | Optional partial wake lock or document |
| L-16 | M | S | `close_range` gate at API 30 unverified on Android 11–14 | Avoid the syscall, or test those versions |
| L-17 | L | C | `destroy()` sends SIGTERM then SIGKILL back to back | 1–2 s grace |
| L-18 | L | C | `resize` can throw after the fd closes | Catch |
| L-19 | L | C | Non-async-signal-safe calls between `fork` and `exec`; 65 k close loop on the fallback | Precompute; read `/proc/self/fd` |
| L-20 | L | C | Crash record has no size cap and goes through an Intent and the share sheet | Cap message and stack |
| L-21 | L | C | `term.open` discards the first-output snapshot | Include it in the reply |
| L-22 | L | S | Ring-buffer replay can start mid-sequence; tiny chunks are memory-heavy | Align to a safe boundary |
| L-23 | L | C | A "0 processes running" notification flashes when the last session ends | Skip or silence the placeholder |
| L-24 | L | S | Back press is swallowed if the renderer hangs | 300 ms fallback |
| L-25 | L | C | Orphan reaping runs on the main thread at startup (200 ms per orphan) | Background thread |
| L-26 | L | C | Release is signed with the debug key | Decide before the first release |

### 4.4 Web — [`area4-web.md`](review-parts/area4-web.md)

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| W-01 | H | C | Same as B-03 | See B-03 |
| W-02 | H | C | Save clears the dirty flag for text that was not written | `saved: doc.content` |
| W-03 | H | C | New file truncates an existing file | Create-new check |
| W-04 | H | C | Save As overwrites and can open the same path twice | Check and confirm |
| W-05 | M | C | The `E_CONFLICT` banner's Reload calls `location.reload()` and drops dirty buffers | Reload the file, not the page |
| W-06 | M | C | No conflict detection exists; save overwrites outside edits | Send an expected mtime with the write |
| W-07 | M | C | Disconnect handling is unreachable (nothing dispatches the event) and clears streams silently | Heartbeat; fail streams; fail fast after disconnect |
| W-08 | M | C/S | Timeout or abort leaves the host process or PTY running | Cancel on late reply |
| W-09 | M | C | No redaction in Copy details, banners or snackbars; the "redacted" test asserts nothing about it | Web redactor and real tests |
| W-10 | M | C | Snackbar `null` duration becomes 4.5 s; the queue is unbounded and not de-duplicated | Fix the default; cap and collapse |
| W-11 | M | C/S | Global handler can show a blocking sheet for a benign `ResizeObserver` error; no re-entrancy guard; boot errors only logged | Filter, guard, report boot errors |
| W-12 | M | C | Back ignores the error sheet and banner; closing the Run sheet kills the process | Sheet stack; hide without cancel |
| W-13 | M | C | "Python missing" is cached until reload, even after installing | Re-probe |
| W-14 | M | C | A closed run's output and exit leak into the next run; two quick taps start two processes | Run id |
| W-15 | M | C | File-list race; `cwd` set before the list succeeds | Request token; set on success |
| W-16 | M | C | Double open creates duplicate tabs | Re-check after the await |
| W-17 | M | C | Folder rename leaves stale tab paths; delete clears the active tab with tabs open and drops dirty buffers silently | Rewrite prefixes; warn |
| W-18 | M | C | CRLF files are converted to LF on first save | Remember and restore line endings |
| W-19 | M | C | `saf://` documents are saved through `fs.write` | Use `saf.save` or disable |
| W-20 | M | C | Terminal acks before xterm renders, so there is no backpressure | Ack in the write callback |
| W-21 | M | C | No PTY resize after attach | Resize after attach |
| W-22 | M | C | A failed attach starts a second shell | Only on `E_NOT_FOUND` |
| W-23 | M | C | Fire-and-forget calls swallow errors (`term.write`, `ack`, `resize`, `proc.cancel`, theme) | Report once per burst |
| W-24 | M | C | The editor remounts on every tab switch; undo history and scroll are lost | One state per document |
| W-25 | M | S | Per-keystroke whole-file work; file list not virtualised | Measure on D1, then fix |
| W-26 | M | C | Restore keeps only paths, replaces newer tabs, forgets tabs that failed once | Merge; persist dirty text |
| W-27 | M | C | Nothing can request the storage permission; shared-storage bookmarks end in a dismiss-only sheet | Wire the permission flow |
| W-28 | M | C | No file-name validation; the prompt closes on failure | Validate; keep open with an inline error |
| W-29 | M | C | Only 3 of 7 panes have an error boundary | Add boundaries |
| W-30 | L | S | Theme has three sources and can overwrite the host's choice at boot | Single source |
| W-31 | L | C | Format-on-save only runs on Ctrl+S | Format in the save path |
| W-32 | L | C | File rows act on `pointerup` only; keyboard Enter does nothing | Add `onClick` and key handling |
| W-33 | L | C | Closed sheets remain `aria-modal` dialogs; no focus trap | `inert`, focus management |
| W-34 | L | C | Settings load has no type validation; several settings are unused | Validate; remove dead keys |
| W-35 | L | C | `lazyWithRetry` flag never cleared | Clear after success |
| W-36 | L | C | `MockBridge` does not match the contract (plain `Error`, overwrites on rename), so store tests give false confidence | Make it throw `AppError`s |
| W-37 | L | C | Stream-handler exceptions escape `receive()` | Guard the call |
| W-38 | L | C/S | Run sheet has no stdin; errors bypass the catalog; unbounded buffer while backgrounded | Stdin field (Task 31) |

---

## 5. Claims in PROGRESS.md and reports that the code does not support

| Claim | What the code does | IDs |
|---|---|---|
| "Nothing is deleted permanently by the bridge" | Purge deletes old trash entries at the next delete | S-01 |
| `fs.read` chunking with `maxBytes` / `nextOffset` (bridge contract) | Not implemented | S-09 |
| "Crash-safe" writes | Process-crash safe only; no directory fsync | S-15 |
| "Streamed methods time only the reply on start" | `runtime.install` replies at the end | B-03, W-01 |
| "SAF callbacks keyed by request code" | A FIFO queue with one in-flight request | B-10 |
| "`proc.*` output coalesced at 16 ms" | Only the terminal stream is coalesced | B-08 |
| "No raw exception text on the wire" | `RuntimeHandler` forwards messages and paths | B-06 |
| "Bounded IO dispatcher" (Task 5) | Unbounded cached thread pool | B-16 |
| "`E_INTERNAL` details go to a redacted log" | The router log line is not redacted | B-06 |
| "If graph construction throws, the next launch opens `RecoveryActivity`" | It cannot; the crash loops | L-02 |
| "Pid reuse is guarded" | Not when the stored start time is 0 or the leader is gone | L-06, L-07 |
| Test "attach to an exited session reports scrollback and the exit code" | The test asserts `null` | L-05 |
| Wake lock (plan v8 mitigation) | Nothing implements it; v9 never recorded dropping it | L-15 |
| "We never start activities from the background" | `handleRendererGone` does | L-09 |
| Task 11: disconnect → `E_BRIDGE_DISCONNECTED` | The event is never dispatched | W-07 |
| Task 12: "every silent `catch {}` replaced" | At least a dozen swallowing catches remain (they pass `no-empty` because they contain a comment) | W-23 |
| Task 12: Copy details redacted | No redaction, no correlation id, method or versions | W-09, L-14 |
| Task 12: undo-ready notifications; per-pane error boundaries | Nothing uses undo; 3 of 7 panes | W-10, W-29 |
| Plan 7.3 "File changed on disk · Reload / Keep mine", "Open settings", "Free space" actions | Not implemented | W-05, W-06, W-27 |
| Task 13: rename keeps the tab | True only for a single file | W-17 |
| Task 10 "device-verified" | The demo (`sleep 600; echo done`) prints almost nothing, so it does not test flow control, wake behaviour or group cleanup | L-08, L-15 |
| Task 9 "closes every fd above stderr" | The fallback loop stops at 65 536 | L-19 |

---

## 6. Behaviour with no test

- **`BridgeHost`** except origin matching: size limit, `id` handling, reply posting, detach. **`ProcHandler`, `TermHandler`, `RuntimeHandler`:** no tests at all.
- **Concurrency:** concurrent `EventSink` flush, replay-versus-live ordering in the registry, count-callback ordering, credit going negative after `beginStreaming`, `close()` while the pump is blocked in `reserve` or in a write.
- **Files:** move-then-purge, delete of the shared trash, symlink delete and rename, FIFO read, invalid UTF-8, the 2 MB versus 4 MB limits, permission preservation, rename of the default workspace, case-only rename, names over 255 bytes, `rel()` behind a symlink.
- **Native and lifecycle:** `killGroup` guards (pid 0, 1, own pid), `OrphanReaper` with start time 0 or a dead leader, `ProcessStartTime.read` with odd command names, `CrashStore` with a corrupt or huge file, `SessionService` ordering, `MainActivity` back and renderer-loss logic, `RecoveryActivity` restart. Native code is only exercised by the debug harness.
- **Redaction:** env-style, JSON-style, URL user-info and prefixed tokens (Kotlin); anything at all (web).
- **Web:** streams in `android.test.ts` (run exit and cancel, term attach ordering, ack, unknown ids, disconnect with open streams, bad base64); all of the store races listed in W-02 to W-26; the back hook; the global handlers; `TerminalPane` and `FileTree` entirely.
- **The tests that exist run against `MockBridge`,** which differs from the real host (W-36). Passing store tests say little about real error codes.

---

## 7. Device checks that would settle the SUSPECTED items

Run these on the phones once they are reachable. Each is a few minutes. Record results in `docs/device-reports/`.

| Item | Check |
|---|---|
| S-04 | `fs.list(".")` on D1 and D2: are `path` values relative or `/data/data/...`? |
| S-12 | On D2 shared storage, rename `a.txt` to `A.txt` |
| B-02 / L-04 | In a terminal run `sleep 1000`, paste more than 64 KB, then close the tab |
| B-14 | `adb shell ls -l /system/bin/setsid` on both phones; `proc.cancel` on `sh -c "sleep 100 & wait"` |
| L-03 | Run two quick `proc.run` calls plus a long job; `adb shell dumpsys activity services dev.leocode` should show `isForeground=true` throughout |
| L-06 | `nohup sleep 999 &` in a terminal, `adb shell kill -9 <app pid>`, relaunch, `ps -A \| grep sleep` |
| L-08 | `yes \| head -c 5000000`, press Home for 30 s, check the process state, return |
| L-09 | Kill the WebView renderer twice with the app in the background; read `logcat` for "Background activity start" |
| L-10 | `adb shell settings put system font_scale 1.3` with an unsaved edit open; also connect a Bluetooth keyboard |
| L-11 | D1 in landscape with navigation buttons; a notch device if available |
| L-13 | Open and exit 50 terminals; `ls /proc/<app pid>/fd \| wc -l` |
| L-15 | Unplug, screen off 10 minutes, run a `date >> file; sleep 5` loop, check for gaps |
| L-16 | Android 11–14 are not covered by any phone; the matrix should say so |
| W-01 / B-03 | Install Python on D1 and watch for the 10 s timeout |
| W-11 | Open the terminal and toggle the soft keyboard; watch for a "Something went wrong" sheet |
| W-25 | Open a 1.5 MB file and type; list a folder with about 5 000 entries |
| W-30 | Set dark, clear only `leocode.user-settings`, relaunch |

---

## 8. Suggested fix order

Do batches 1–3 **before** the Python phase (Tasks 24–26, 30–33) and before Phase D. The Python installer depends on the timeout, the handler, the stream re-attach and the file layer being right.

| Batch | Contents | Why first |
|---|---|---|
| 1. Data loss and crashes | S-01, S-02, L-01, L-02, B-01, S-10/S-11/B-10, S-13, W-02, W-03, W-04 | Each can destroy files or kill the app; all are small fixes |
| 2. Contract and timeouts | B-03/W-01, B-04, B-06, B-18, B-19, W-07, W-08, W-37 | Unblocks the installer and makes failures honest |
| 3. Terminal and process concurrency | B-02/L-04, B-05, B-11, B-12/L-03, L-05, L-12, L-13, B-07, B-08, B-09, B-21, W-20, W-21, W-22 | Freezes and lost output |
| 4. Crash handling and privacy | L-09, L-10, L-11, L-14, L-20, W-09, W-11, W-23, B-17 | Redaction, recovery path, insets |
| 5. Editor and files | W-05, W-06, W-12 to W-19, W-24, W-26 to W-29, S-03 to S-09, S-12 | User-visible correctness |
| 6. Polish and tests | everything Low; add the missing tests from Section 6; `MockBridge` parity (W-36) | After behaviour is right |

For every fix, add a test that fails before the change. Several findings (S-01, L-01, B-01, W-02) are one-line tests.

---

## 9. What was not reviewed

- Not read in full: `Sidebar.tsx`, `SettingsDialog.tsx`, `EditorMenus.tsx`, `Icons.tsx`, `editorThemes.ts`, and the UI half of `RuntimeManager.tsx` (searched for error handling and install calls only). 48 dp targets and focus behaviour were not checked in CSS.
- `RuntimeInstaller` was reviewed only for file handling and how it is called. Its known prototype defects (P-01 to P-10) are in [`phase-a-analysis.md`](phase-a-analysis.md) and are not repeated.
- No device was available. Android 10–14 have no hardware; findings L-16 and L-10 could differ there.
- No dynamic analysis, fuzzing or load test was run. Race findings come from reading lock structure.
- CI has not run on GitHub; nothing here says whether the Task 7 drift step passes there.

---

## 10. Hand-off prompt for the fixing model

> You are fixing the findings in `docs/reports/phase-b-c-analysis.md` on branch `v9-impl` of `/home/sourav/Desktop/Apps/leocode`. Read that report completely, then the review file for the area you are touching under `docs/reports/review-parts/`. Work in the batch order of Section 8, one commit per batch group. For every ID: write a test that fails first, fix it, and run only the checks relevant to that change (web: `npm run typecheck && npm run lint && npm test`; Android: `./gradlew testDebugUnitTest lintDebug` from `android/`). Treat line numbers as approximate and search by symbol. Do not change `targetSdk`, do not push, and do not touch the Python prototype (`RuntimeInstaller`, `python_launcher.c`) except where a finding names it. When a finding is marked SUSPECTED, run the device check in Section 7 first if a phone is connected, and record the result in `docs/device-reports/`; otherwise leave it open and say so in `PROGRESS.md`. Stop after batch 3 and report.
