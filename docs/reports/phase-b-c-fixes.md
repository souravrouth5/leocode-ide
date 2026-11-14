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

## Batches 4–6 (fixed after the first fix pass)

| Batch | Commit | IDs fixed |
|---|---|---|
| 4 web | `640ac2d` | W-09 (redaction on every message sink), W-11 (benign-error filter, dedupe/storm cap, re-entrancy, boot-error queue), W-23 (fire-and-forget reporting) |
| 4 Android | `4f6c7f8` | L-09 (deferred renderer recovery, persisted loss time), L-10 (`configChanges`), L-11 (side/cutout insets), L-14 (wider `Redactor`), L-20 (crash caps), B-17 (origin port) |
| 5 Android | `4a72324` | S-03 (regular files only, bounded read), S-04 (canonical `rel`), S-05 (symlink delete/rename), S-07 (permission preservation), S-08 (strict UTF-8), S-09 (4 MB read), S-12 (case-only rename) |
| 5/6 web | `2467948` | W-05 (per-report reload action; conflict *detection* still open), W-10, W-12 (sheet stack + ordered back; run hide vs stop), W-13, W-14, W-15, W-17, W-18, W-19, W-24 (per-tab pane state), W-26, W-27 (storage permission flow), W-28 (prompt validation), W-29 (pane boundaries), W-32, W-34, W-35, W-36 |
| 6 partial | `56fc5bf` | L-16 (`close_range` removed), L-17 (exit grace), L-18 (resize guard), L-19 (precomputed fd bound), L-21 (`term.open` early output), L-22 (aligned replay) |

Android suite: **194 tests** (forced rerun), `lintDebug` green, 16 KB check PASSED. Web: **183 tests**
(33 files), typecheck/lint clean, build OK. `vitest.config.ts` pins `NODE_ENV=development` because the
shell exports `production`, which makes React's `act()` unusable.

## Device verification after batches 4–6 (both phones)

Same APK installed on D1 and D2; screenshots under `docs/device-reports/`.

| Check | D1 | D2 |
|---|---|---|
| Cold boot + terminal PTY + foreground service | PASS | PASS |
| Rotation with live shell (L-10/L-11) | PASS — shell pid unchanged, full-width landscape after relayout (`...-203906-fix-d1-landscape2-...png`) | — |
| Font scale with live shell (L-10) | — | PASS — shell pid unchanged, app resumed (`...-203745-fix-d2-fontscale-...png`) |
| Executable bit survives an editor save (S-07) | — | PASS — `perm.sh` 755 before and after (`...-205501-fix-d2-saved-ctrl-s-...png`) |
| Invalid name keeps the prompt open (W-28) | — | PASS — inline “A name cannot contain…” (`...-210532-final-prompt-invalid2-...png`) |
| Error sheet offers Grant storage access (W-27) | — | PASS (`...-210708-final-storage-permission-...png`) |
| Permission dialog + grant | — | PASS — READ/WRITE granted, row disappears (`...-210948-final-permission-dialog2-...png`, `...-211058-final-permission-granted-...png`) |
| Downloads lists real files after grant | — | PASS (`...-211301-final-downloads-list-...png`) |

## Behaviour changes worth knowing

- `runtime.install` no longer times out in the client. A host that never replies leaves the promise
  pending until the user cancels; Task 25 should move the reply to the start.
- The message cap is 8 MB instead of 256 KB. Per-method limits are now 4 MB for reads, writes and SAF.
- A renderer loss or Activity finish cancels `proc.run` jobs; terminals still survive and reattach.
  A background renderer loss is deferred to `onResume`; no Activity starts from the background.
- Exited terminals remain reachable (scrollback + exit code) until attached or closed, capped at 8.
- `fs.read`/`fs.write` are both capped at 4 MB; malformed UTF-8 is `E_BINARY`, and a non-regular file
  is rejected before reading.
- Storage permission is requestable from the drawer, Settings and the path-jail error sheet.
- The Run sheet now hides without cancelling on back/X; Stop and Stop all still cancel.
- Web messages (sheets, banners, snackbars, Copy details, boot errors) are redacted; normal file and
  terminal output is not.

## Still open (narrow)

- **W-06 conflict detection** and the “Reload / Keep mine” choice: the action plumbing exists (W-05),
  but `fs.write` has no expected-mtime precondition yet. This needs a host + client change.
- **L-06** reaper does not scan `/proc` when the group leader already exited.
- **L-08** terminals attached while the Activity is stopped can still stall at the credit limit; the
  detach-on-`onStop` fix needs the page to reattach every open tab.
- **L-15** no wake lock; CPU may suspend with the screen off. Documented, not implemented.
- **L-24** back hook has no timeout fallback if the renderer hangs.
- **S-15/S-16/S-17/S-18** directory fsync, `.tmp` sweep, SAF binary check, purge off the request path.
- **S-19/S-20** debug origin surface and the meta-CSP `frame-ancestors`/extraction cap.
- **B-14** group kill still relies on `/system/bin/setsid` (present on both phones).
- **B-15/B-16** env override reporting and the unbounded bridge pool/per-path ordering.
- **W-25** large-file/per-keystroke performance and file-list virtualisation (needs measurement).
- **W-30** theme has three sources; **W-31** format-on-save only on Ctrl+S; **W-33** closed sheets
  remain `aria-modal` without a focus trap; **W-38** run stdin and raw run errors.
- Device checks not yet run: S-12 case-only rename on shared storage, L-09 renderer kill while
  backgrounded, W-24 visual scroll/undo across tabs, W-18 a real CRLF file, W-12 run-hide.
- Android 10–14 have no hardware; CI has still not been observed running on GitHub.

Claim corrections after this pass:

- "Nothing is deleted permanently by the bridge" holds (S-01).
- The contract no longer claims `fs.read` chunking (planned Task 15) or a 256 KB message cap; the read
  and write limits now match at 4 MB.
- Task 11's disconnect is reachable and fails streams; Task 12's Copy details **is** redacted now
  (W-09) and fire-and-forget failures are reported once per burst (W-23). The SAF flow is still a
  FIFO queue with one in-flight request (failure handling fixed, pattern unchanged).
- "Crash-safe writes" remains process-crash safe only (no directory fsync, S-15).
