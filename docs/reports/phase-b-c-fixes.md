# Phase B/C review fixes — batches 1–3

**Date:** 2026-11-14 · **Branch:** `v9-impl` · **Review:** [`phase-b-c-analysis.md`](phase-b-c-analysis.md)
**Scope:** the hand-off asked for batches 1–3 and a stop. Batches 4–6 remain open (Section 5).

## Commits

| Batch | Commit | Theme |
|---|---|---|
| Report | `d2d1714` | The analysis and the four area reviews (docs only) |
| 1 | `8889bac` | Data loss and crashes |
| 2 | `4b4e9a1` | Contract, timeouts and honest failures |
| 3 | `cad444a` | Terminal/process concurrency and lifecycle |

Every fix has a test that fails before it where the behaviour is unit-testable. Totals after batch 3:
Android unit suite green (130 tests), `lintDebug` green, 16 KB alignment PASSED, web typecheck/lint clean,
**71 web tests** green, debug APK built and installed on D1.

## Batch 1 — data loss and crashes

| ID | Fix |
|---|---|
| S-01 | Trash `purge` ages entries by the timestamp embedded in the trash name, not the preserved mtime; a 45-day-old file deleted now survives the next purge and expires after 30 days. |
| S-02 | Both trash directories are protected from delete/rename, `.leocode-trash` is hidden from `fs.list`, `Trash.move` refuses to trash the trash or a destination under the source, and names are truncated below `NAME_MAX`. |
| S-13 | Renaming the default workspace (or a trash root) returns `E_PERMISSION`. |
| L-01 | `killGroup` rejects pid ≤ 1, the app's own pid/group and pids above `pid_max`; the reaper applies the same guard before signalling. |
| L-07 | A pidfile is never written without a start time, and a stored `startTime <= 0` is no longer treated as a match. |
| L-02 | `AppGraph` construction is guarded; `LeoApp.startupError` makes `MainActivity` open `RecoveryActivity` with a startup reason instead of crash-looping. Reaping moved off the main thread. |
| B-01 | Envelope ids are parsed with `SafeEnvelope` (no throwing `jsonPrimitive`); object/array ids get `E_BAD_ENVELOPE`, and the whole `onPostMessage` body is guarded (also covers a rejected execute after detach). |
| S-10/S-11/B-10 | `SafPort` reports `Result`; provider read failures no longer kill the process, a failed write is reported instead of returning a URI, and both map to `E_IO` / `E_PERMISSION` with fixed text. |
| W-02 | `save` records the exact content it wrote, so text typed during the write stays dirty. |
| W-03 | New File checks the parent listing and refuses to truncate an existing entry. |
| W-04 | Save As asks before replacing an existing path and switches to an already-open tab instead of duplicating it. |
| W-16 | `openFile` re-checks after the read, so a double tap cannot create two tabs. |

## Batch 2 — contract and timeouts

| ID | Fix |
|---|---|
| B-03/W-01 | `runtime.install` has no client timeout. The host replies when the install finishes; the contract says so and Task 25 will move the reply to the start. |
| B-04 | Incoming message cap raised to 8 MB so the documented 4 MB write is reachable; `E_LIMIT` now carries the request id (bounded prefix parse), and the client rejects an oversize request before posting. |
| B-06 | Installer failures use fixed user copy; the raw detail goes to a redacted log with a correlation id. The router redacts its `E_INTERNAL` log line. |
| B-18 | Strict envelope: a string `v` is `E_BAD_ENVELOPE`, a numeric non-1 is `E_UNSUPPORTED`, and a non-object payload is rejected before the handler. |
| B-19 | `BridgeJson` sets `encodeDefaults = true`; `TermOk.ok`, `TermInfo.root` and `AppInfo` fields stay on the wire. |
| W-07 | Disconnect is reachable and honest: the injected-channel identity check, a `leocode:bridge-disconnected` event, or three consecutive timeouts raise it. Open streams receive a failure (a run rejects, a terminal exits), and later calls fail immediately. |
| W-08 | A late reply after a timeout/abort cancels the work: `proc.cancel`, `term.close` for an orphan PTY, `runtime.cancel` for an install. |
| W-37 | Stream handler exceptions are contained; a bad base64 event no longer reaches the window error handler. |

## Batch 3 — terminal and process concurrency

| ID | Fix |
|---|---|
| B-02/L-04 | A PTY write checks `alive` under the lock and writes outside it, so a blocked tty write cannot freeze output, ack, resize or close. |
| B-05 | `EventSink` serialises collect+post, so concurrent flushes cannot swap batches. |
| B-11 | Queued chunks replay under the lock before live data can overtake them. |
| B-12/L-03 | `AppGraph` reads both counts under the lock that applies them; `SessionService` uses `stopSelf(startId)`, so a later start survives. The placeholder says "Stopping sessions". |
| L-05 | Exited sessions are kept (up to 8) with ring buffer, `alive=false` and exit code; `term.attach` delivers them once and then closes them. |
| L-12 | `term.open` is capped at 8 live sessions (`E_LIMIT`); rows/cols are clamped to 1..1000. |
| L-13 | The pump's `finally` closes the master fd and signals leftover group members. |
| B-07 | Child stdin is closed immediately, so `cat`, `python -` and `input()` get EOF. |
| B-08 | `proc.*` output goes through the 16 ms coalescer and a truncation notice replaces silent loss at the cap. |
| B-09 | Jobs are cancelled when the Activity finishes or the renderer is lost (they have no reattach path); terminals keep theirs. |
| B-21 | A pidfile failure can no longer skip the output/wait threads. |
| W-20 | Terminal data is acked in xterm's write callback, restoring the 256 KB credit window. |
| W-21 | The PTY is resized right after a successful attach. |
| W-22 | Only `E_NOT_FOUND` falls back to a new shell; other attach failures are reported and leave the session alone. |

## Device verification (D1 Redmi Note 7S / Android 9 · D2 POCO F1 / Android 15)

The same APK was installed on both phones. Built from the synced bundle, `lintDebug` green,
16 KB check PASSED.

| Check | D1 | D2 |
|---|---|---|
| App boot after the startup guard | **PASS** (`...-191701-review-fix-home-...png`) | **PASS** (`...-193142-fix-d2-home-...png`) |
| Terminal PTY after the write/exit changes | **PASS** — prompt + key row (`...-191736-review-fix-terminal-...png`) | **PASS** — prompt, `SessionService isForeground=true` (`...-193148-fix-d2-terminal-...png`) |
| Background + reattach with a live session | earlier run (same PID across recreation) | **PASS** — `sleep 45; echo d2-alive` typed, Home 12 s, returned with the command and a live `sh`/`sleep` (`...-193235-fix-d2-reattach-...png`) |
| Exited while detached, then reattach (L-05) | **PASS** — shell SIGKILLed via `run-as` while Home: scrollback, `[session ended, exit 137]`, EXITED 137 badge, no new shell (`...-194200-fix-d1-exited-reattach2-...png`; SIGTERM alone is ignored by `sh -i`) | **PASS** — `echo bye-d2; exit`, Home, return: full scrollback, `[session ended, exit 0]`, EXITED 0 badge, no new shell (`...-193344-fix-d2-exited-reattach-...png`) |
| SAF cancel after the `Result` port change | **PASS** — "No document selected" (`...-191748-review-fix-saf-cancel-...png`) | **PASS** — same snackbar (`...-193447-fix-d2-saf-cancel-...png`) |

SUSPECTED findings in batches 1–3 that still need the phone checks from report §7: B-02/L-04's
kernel-level block (the lock fix is structural and tested), L-03's service ordering (fixed by
`stopSelf(startId)`; not re-measured), L-08 (backpressure while backgrounded, batch 4) and B-14's
`setsid` presence (batch 6).

## Behaviour changes worth knowing

- `runtime.install` no longer times out in the client. A host that never replies leaves the promise
  pending until the user cancels; Task 25 should move the reply to the start.
- The message cap is 8 MB instead of 256 KB. The per-method limits (4 MB write, 2 MB read, 4 MB SAF)
  still apply.
- A renderer loss or Activity finish cancels `proc.run` jobs. Terminals still survive and reattach.
- Exited terminals remain in the registry until attached or closed, capped at 8.

## What remains (batches 4–6)

Not fixed in this pass, in the report's own order:

- **Batch 4 — crash handling and privacy:** L-09 (renderer restart while backgrounded), L-10
  (`configChanges`), L-11 (left/right/cutout insets), L-14 (wider `Redactor`), L-20 (crash record
  cap), W-09 (web redaction of Copy details/messages), W-11 (global handler filtering/re-entrancy),
  W-23 (fire-and-forget calls still swallowed), B-17 (origin port, execute guard).
- **Batch 5 — editor and files:** W-05/W-06 (conflict banner reload + detection), W-12 (back/sheet
  stack), W-13..W-19, W-24, W-26..W-29, S-03..S-09, S-12.
- **Batch 6 — polish/tests:** all Low items, `MockBridge` parity (W-36), broader tests.

Claim corrections after this pass:

- "Nothing is deleted permanently by the bridge" (S-01) now holds; purge uses the trash time.
- The contract no longer claims `fs.read` chunking (it is planned with Task 15) or a 256 KB message cap.
- Task 11's disconnect is now reachable and fails streams; Task 12's "Copy details redacted" and
  "every silent catch replaced" **remain untrue** (W-09/W-23, batch 4), and the SAF flow is still a
  FIFO queue with one in-flight request (failure handling fixed, pattern unchanged).
- "Crash-safe writes" remains process-crash safe only (no directory fsync, S-15, batch 5).

CI has still not been observed running on GitHub.
