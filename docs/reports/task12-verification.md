# Task 12 verification — error UX system

**Date:** 2026-11-14 · **Branch:** `v9-impl` · **Plan:** [v9 §15](../LeoCode_Implementation_Plan_v9.md) Task 12

## What changed

| Piece | Location | Behaviour |
|---|---|---|
| Catalog | `web/src/errors/catalog.ts` | One entry per generated `ErrorCode`: plain-language title + explanation, severity, surface and exactly one action (`retry` / `reload` / `dismiss`). `toAppError` wraps unknown throws as `E_INTERNAL`; `errorDetails` builds the Copy-details text without a stack, path or secret. |
| Snackbar store | `web/src/notifications/notificationsStore.ts` | Zustand queue with kind, optional detail and action, sticky (`durationMs: null`) or auto-dismiss. |
| Error router | `web/src/errors/errorsStore.ts` | `report(error, { context, retry })` routes by catalog surface: snackbar for transient, banner for recoverable (with Retry/Reload), sheet for blocking explanations. |
| Surfaces | `errors/Snackbar.tsx`, `InlineBanner.tsx`, `ErrorSheet.tsx` | Snackbar (message, detail, action, dismiss), banner (`alert`/`status`), sheet (title, explanation, raw message, one primary action, **Copy details**). |
| Containment | `errors/ErrorBoundary.tsx`, `CrashScreen.tsx` | Each pane (editor, terminal, runtimes) has its own boundary with **Try again**; the app has a crash screen with **Reload LeoCode** and Copy details. |
| Lazy chunks | `errors/lazyWithRetry.ts` | A stale hashed chunk after an app update reloads once (guarded by `sessionStorage`), then falls through to the boundary. |
| Global safety net | `errors/globalHandlers.ts` | `window.error` and `unhandledrejection` are reported; nothing is console-only. |
| Demo switch | `errors/simulate.ts` | `?simulate=<code>` raises a typed error through the normal router (mock mode). |
| Styles | `web/src/styles.css` (error section) | Tokens reuse the existing theme variables; no new theme keys. |

### Silent failures replaced

| Before | Now |
|---|---|
| File list / open / save / reload / rename / delete failures set a raw `e.message` in one generic sheet | Reported with an operation context; surface and primary action come from the catalog |
| SAF picker cancel returned silently | “No document selected” snackbar |
| Session restore dropped unreadable tabs silently | “N restored tabs could not be opened” warning once |
| `localStorage` session save failed silently | “Session state could not be saved” warning once (not per keystroke) |
| Unsupported Run target showed a raw string | Warning snackbar with the file name and the reason |
| Editor/terminal/runtime render crash = blank pane | Pane boundary with Try again + Copy details |
| Boot info failure was swallowed | Reported while boot continues |

## Tests

| File | Covers |
|---|---|
| `errors/catalog.test.ts` (5) | Catalog keys equal `ERROR_CODES`; every entry has copy/action; contract surface choices (timeout banner, disk-full sheet, not-found snackbar, disconnect reload); unknown errors → `E_INTERNAL`; details are stack-free |
| `errors/errorsStore.test.ts` (4) | Snackbar/banner/sheet routing, retry attached to the banner, dismiss |
| `errors/surfaces.test.tsx` (5) | Snackbar action + dismiss, banner action + dismiss, sheet copy/retry, boundary containment and reset, Copy details calls the clipboard |
| `errors/simulate.test.tsx` (3) | `?simulate=E_DISK_FULL` opens the sheet; `E_TIMEOUT` shows the banner; `E_NOT_FOUND` queues a snackbar |

Suite total: **39 tests passing**.

## Demo

- **Mock:** `?simulate=E_TIMEOUT` → banner with Retry; `?simulate=E_DISK_FULL` → sheet with the explanation and Copy details; `?simulate=E_NOT_FOUND` → snackbar. Covered by the integration tests above (headless Firefox screenshots at the load event run before post-load effects, so the tests are the evidence).
- **D1:** open Explorer → “Open via SAF (System Picker)”, then press Back in the system picker → the app returns with a “No document selected” snackbar. Evidence: [`20261114-162304-saf-cancel-11f98015.png`](../device-reports/20261114-162304-saf-cancel-11f98015.png) (sidebar in `...-162226-saf-sidebar-...png`).

## Gates

| Check | Result |
|---|---|
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** — 0 errors |
| `npm test` | **PASS** — 39 tests |
| `npm run build` / `sync-web.sh` | **PASS** |
| Android assemble + install on D1/D2 | **PASS** |

## Open

- The catalog's `E_PERMISSION` action is Dismiss with settings instructions; a deep link to Android settings needs a future bridge method.
- Disk-full on-device is not simulated (mock covers the surface); GitHub Actions has still not been observed running.
