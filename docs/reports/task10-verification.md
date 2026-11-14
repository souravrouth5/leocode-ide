# Task 10 verification — background survival and reattach

**Date:** 2026-11-14 · **Branch:** `v9-impl` · **Plan:** [v9 §15](../LeoCode_Implementation_Plan_v9.md) Task 10

## What changed

### Session ownership

| Before | After |
|---|---|
| `TermHandler` owned a `ConcurrentHashMap` of sessions and one pump thread per `term.open` request | `core/TerminalRegistry` owns sessions for the whole application process. It keeps reading while no WebView is attached. |
| Activity `onDestroy` called `graph.closeBridge()` (killed every PTY and job) | `onDestroy` calls `graph.detachBridge()` plus `BridgeHost.detach()`; PTYs and jobs stay alive under the foreground service |
| Renderer loss rebuilt the WebView but the old stream was gone with no replay | The new page reattaches with `term.attach` and receives base64 scrollback before live data |
| No notification | `SessionService` shows “N processes running” with **Stop all**; the channel is created on the first session only |

### New pieces

- **`core/RingBuffer.kt`** — bounded byte buffer (256 KB per session). Chunks are stored by reference and trimmed at the head; an oversized write keeps its tail. Snapshots are copied.
- **`core/TerminalRegistry.kt`** — `open`, `attach`, `list`, `write`, `resize`, `ack`, `close`, `closeAll`, `detachAll`. A session has a reader thread, a ring buffer, one listener, the existing 256 KB credit window and a pause queue. `attach` snapshots the ring and pauses streaming; the handler posts the reply first, then `start()` flushes data that arrived during the handshake. That guarantees scrollback-then-live ordering. `term.open` attaches the request's stream through the same path, so the first terminal gets output without a second round trip.
- **`core/PidFileStore.kt` / `core/ProcessStartTime.kt` / `core/OrphanReaper.kt`** — `pid starttime kind` files under `files/run`. The reaper compares `/proc/<pid>/stat` field 22, SIGTERMs the group, waits 200 ms, SIGKILLs if still present, and deletes the file. Pid reuse is ignored.
- **`SessionService.kt`** — foreground service, low-importance channel, `START_NOT_STICKY`, Stop all invokes `AppGraph.closeBridge()`. `POST_NOTIFICATIONS` is requested from the first session on Android 13+ (never at app launch). A `count == 0` update makes the service start foreground once (required for a `startForegroundService` request) and then stop itself; callers no longer `stopService()` a pending start.
- **`bridge/TermHandler.kt`** — delegates to the registry; `term.attach` and `term.list` added. Both `term.open` and `term.attach` answer through `AsyncBridgeHandler` so the reply is queued before the first `term.data`.
- **`bridge/Contract.kt`** — `TermAttachReply` and `TermInfo` DTOs; `types.gen.ts` regenerated.
- **`AppGraph` / `LeoApp`** — counts terminals + jobs, starts/updates/stops the service, reaps orphans at process start.
- **Web** — `Bridge.attachTerminal` / `listTerminals`, an `AndroidBridge` `TerminalChannel` with ack/write coalescing and attach ordering, session id in `localStorage`, reattach in `TerminalPane` with fallback to `openTerminal`, and detach (not close) on unmount.
- **Settings → Environment** — MIUI/HyperOS autostart + battery, Android 12+ phantom-process killer, rooted `max_phantom_processes`.
- **`scripts/device.sh`** — reusable adb test CLI (slots, install/launch, tab taps with per-navigation-mode offsets, safe typing, screenshots, service/notification dumps, reports) used for the runs below.

## Tests

| Check | Result |
|---|---|
| `RingBufferTest` | **PASS** — drop-oldest, oversized tail, partial head trim, clear |
| `TerminalRegistryTest` | **PASS** — snapshot + live stream, detach/reattach replay, exited session, unknown id |
| `OrphanReaperTest` | **PASS** — SIGTERM, SIGKILL, recycled pid ignored, unreadable file removed |
| `ProcessSupervisorTest` | **PASS** — pidfile written while running and removed on exit |
| `BridgeTypesCoverageTest` | **PASS** — new DTOs are in the generator seeds |
| `testDebugUnitTest` | **PASS** — 94 tests, 0 failures |
| `lintDebug` | **PASS** (blocking) |
| `assembleDebug` | **PASS** — APK includes the synced web bundle |
| 16 KB check (`scripts/check-elf-alignment.sh`) | **PASS** — 2 ELF files, LOAD `p_align 0x4000` |
| Web lint / test / typecheck / build | **PASS** — 12 tests before Task 11 additions |

## Defects found by the device run (fixed)

1. **Foreground-service stop race (D2, Android 15).** A short runtime probe starts and ends before the main thread delivers the service's first start command; `sessionCountChanged(0)` called `stopService()`, and Android threw `ForegroundServiceDidNotStartInTimeException` (app crash). Fix: count `0` is delivered as an update and the service answers the pending start with `startForeground` before stopping itself.
2. **`term.open` streamed nothing (both phones).** Moving sessions into `TerminalRegistry` left `term.open` without a listener, so the terminal showed a cursor but no shell output. Fix: `openSession()` attaches the request's stream and starts it after the reply, exactly like `term.attach`.
3. **`close_range()` killed the bridge thread on Android 9 (D1).** Syscall 436 is not in the API-28 seccomp allowlist, so the kernel killed `leocode-bridge` with `SIGSYS` when a terminal opened (`Fatal signal 31 (SIGSYS), code 1 (SYS_SECCOMP)`). Fix: gate `close_range` on `android_get_device_api_level() >= 30`; older devices use the bounded `close()` loop.

## Device demo

Evidence is under [`docs/device-reports/`](../device-reports/).

**D2 (POCO F1, Android 15) — background 10 minutes**

```bash
scripts/device.sh --device d2 install
scripts/device.sh --device d2 start
scripts/device.sh --device d2 tab terminal
scripts/device.sh --device d2 type 'sleep 600; echo done' --enter
scripts/device.sh --device d2 key home        # 15:22
# … 10+ minutes …
scripts/device.sh --device d2 start           # 15:34
scripts/device.sh --device d2 shot task10-done
```

Result: **PASS**. `ps -A` showed `sh` + `sleep 600` with the app backgrounded; `dumpsys activity services` showed `SessionService isForeground=true` and the notification “1 process running” with a **Stop all** action; the returned page replayed the scrollback, printed `done`, and showed a fresh prompt with no new shell banner.

**D1 (Redmi Note 7S, Android 9) — rotation and Activity recreation**

- A terminal session (shell pid 7638) survived portrait → landscape → portrait.
- Changing `wm density` forced an Activity recreation (density is not in `configChanges`); the shell pid was unchanged and the re-mounted terminal replayed its scrollback through `term.attach`.
- The notification was captured with `1 process running` and the Stop-all action.

One automation caveat: on D1 the WebView's handling of injected key events duplicates characters (`echo hi-d1` → `ecchoo hhi--d11`). It affects `adb shell input text` only; the PTY, echo and exit codes are healthy, and typing from the on-screen keyboard is unaffected. The script therefore supports `type … --slow` for old devices.

Screenshot index:

| File | What it shows |
|---|---|
| `20261114-153434-task10-done-192.168.29.151_40037.png` | D2 after >10 min backgrounded: `done` + prompt |
| `20261114-155805-d1-reattach-fresh-11f98015.png` | D1 after forced recreation: replayed scrollback, same shell |
| `20261114-160036-devicectl-task10-final-192.168.29.151_40037.txt` | D2 service, notification, processes, logcat |
| `20261114-160039-devicectl-task10-final-11f98015.txt` | D1 service, notification, processes, logcat |

## Still open

- Phantom-process killer effect, low-memory kill and storage-pressure rows are not measured.
- GitHub Actions has still not been observed running.
