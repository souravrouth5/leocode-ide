# Task 11 verification — bridge client hardening

**Date:** 2026-11-14 · **Branch:** `v9-impl` · **Plan:** [v9 §15](../LeoCode_Implementation_Plan_v9.md) Task 11

## What changed

| Requirement | Implementation |
|---|---|
| Per-method default timeouts (contract table) | `web/src/bridge/timeouts.ts`: fast 10 s (`app.*`, reads, `term.write/resize/ack`, `root.status`), write 20 s (`fs.write`, `workspace.*`), no default for user-driven `saf.*`, `storage.requestPermission`, `root.request`, `ssh.hostkey.answer`; streamed methods time their *reply on start* only (events are not timed). `RequestOptions.timeoutMs` overrides per call; `null` disables. |
| `AbortSignal` | Any method accepts `RequestOptions.signal`; `TerminalOptions.signal` is honoured by `openTerminal`. An already-aborted signal rejects with `E_CANCELLED` without posting; aborting in flight removes the pending slot and stream. |
| Pending-request cleanup | Every request stores a `cleanup` (timer + abort listener). Timeout, abort, disconnect and normal replies settle once; late replies find no pending entry and are dropped. |
| Disconnect → `E_BRIDGE_DISCONNECTED` | `AndroidBridge.disconnect()` rejects every pending request and clears streams. The page can dispatch `leocode:bridge-disconnected`; the client listens for it. |
| Typed `AppError` | `AppError` carries the generated `ErrorCode` union; `BridgeError` remains an alias so existing imports and `instanceof` checks keep working. Unknown host codes map to `E_INTERNAL`. |
| Retry idempotent reads once | `fs.list`, `fs.read`, `app.info`, `app.theme.get`, `storage.info`, `term.list` retry once after `E_TIMEOUT` while the signal is live. Writes and streams never retry. |
| Detect Android without the user agent | `createBridge()` waits for the injected `window.LeoCodeAndroid` channel (through the load event). A host page (`appassets.androidplatform.net`) without a channel is a start-up error; any other page gets the mock. |

## Tests

`web/src/bridge/android.test.ts` (7), `web/src/bridge/timeouts.test.ts` (6):

- 20 s write timeout, no retry;
- idempotent read retries once, second reply resolves, late first reply ignored;
- read rejects `E_TIMEOUT` after the single retry;
- pre-aborted signal posts nothing; in-flight abort rejects and drops the late reply;
- `disconnect()` rejects all pending with `E_BRIDGE_DISCONNECTED` and ignores late replies;
- unknown host error code → `E_INTERNAL`;
- timeout table covers fast/write/user-wait/streamed classes and per-call overrides.

`web/src/errors/simulate.test.tsx` renders the app with `?simulate=E_TIMEOUT` and asserts the timeout banner appears; `?simulate=E_NOT_FOUND` queues a snackbar and `?simulate=E_DISK_FULL` opens the sheet (Task 12 surfaces).

## Gates

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** — 0 errors (warnings only, cleaned in Task 13) |
| `npm test` | **PASS** — 39 tests |
| `npm run build` / `sync-web.sh` | **PASS** — APK bundle synced and installed on D1/D2 |

## Notes

- The headless Firefox screenshot tool captures at the load event, before post-load effects, so the `?simulate=` surfaces are verified by the integration tests rather than a still image.
- The client timeout applies to the reply only; a stream that stops sending events is a host bug, detected by the terminal's exit event rather than a timer.

## Open

- GitHub Actions has still not been observed running.
