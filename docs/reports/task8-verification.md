# Task 8 verification — activity modernisation and crash recovery

**Date:** 2026-11-14 · **Device demo:** 2026-11-21 · **Branch:** `v9-impl` · **Plan:** [v9 §15](../LeoCode_Implementation_Plan_v9.md) Task 8

## What changed

| Area | Change |
|---|---|
| Activity | `MainActivity` extends `androidx.activity.ComponentActivity` (activity-ktx 1.9.3). |
| Results | `registerForActivityResult` with `OpenDocument`, `CreateDocument("text/plain")` and `RequestMultiplePermissions`. Per-launcher request queues replace the request-code maps; overlapping SAF picks and permission prompts stay matched to their callbacks. |
| Back | `OnBackPressedDispatcher` callback calls `window.__leocodeBack`; returns to the system when the web layer says it cannot go further. |
| Insets | `WindowCompat.setDecorFitsSystemWindows(false)` + `WindowInsetsCompat` listener. `--inset-top`, `--inset-bottom`, `--ime-bottom` are pushed to `document.documentElement` as CSS pixels; `styles.css` consumes them with browser-safe fallbacks. |
| Renderer loss | `onRenderProcessGone` returns `true`, destroys the dead WebView, rebuilds it and keeps the graph alive (`BridgeHost.detach()`). A toast and an in-page banner show “Restored after a problem”. Two losses inside 60 s open `RecoveryActivity`. |
| Asset errors | `onReceivedError` for the main frame on the asset origin replaces the page with a native Retry page; a failed dev server falls back to the embedded bundle. |
| Crash recovery | `CrashStore` wraps the default uncaught-exception handler, writes `files/crash/last-crash.json` atomically, and `MainActivity` opens native `RecoveryActivity` on the next launch (Restart, Share diagnostics, Close). |
| Redaction | `Redactor` removes absolute paths, assignments (`token=…`, `api_key: …`), Bearer/Basic credentials and credential query parameters. `CrashStore.shareText` runs the whole report through it. |
| CSP / fonts | `web/index.html` has a `__LEOCODE_CSP__` placeholder; Vite bakes the strict production policy and a dev-only policy for HMR. The boot theme script moved to `public/boot-theme.js` so no inline script is needed. Google Fonts links are gone; Fira Code, JetBrains Mono, Roboto Mono and Source Code Pro are bundled as local variable woff2 files. |
| Demo hooks | Debug-only `--ez forceCrash true` throws after `super.onCreate`; the crash store then opens `RecoveryActivity` on the next start. Renderer loss is exercised with CDP `Page.crash`. |

## Gates

| Check | Result |
|---|---|
| `testDebugUnitTest` | **PASS**: 94 tests, 0 failures, 0 errors |
| `lintDebug` | **PASS** (blocking) |
| `assembleDebug` / `assembleRelease` | **PASS**: debug 34,288,973 B; release 25,937,286 B |
| 16 KB check (`check-elf-alignment.sh`) | **PASS**, 2 ELF files |
| Web lint / test / typecheck / build | **PASS**: 12 tests (3 files), 0 lint errors |
| Fonts bundled | **PASS**: 4 woff2 files emitted to `dist/assets/`, no `fonts.googleapis.com` in `dist/index.html` |
| Strict CSP in built page | **PASS**: `default-src 'self'; …; script-src 'self'; connect-src 'self'` |
| No inline scripts in `index.html` | **PASS** (`security.test.ts`) |
| No remote origins in `index.html` | **PASS** (`security.test.ts`) |
| `Redactor` tests | **PASS**: 6 cases (paths, query credentials, assignments, bearer/basic, ordinary text, idempotence) |

## Device demo

**Result: PASS on D1 (Android 9 / API 28) and D2 (Android 15 / API 35), 2026-11-21.** Both phones ran
the current `app-debug.apk` (versionCode 2, targetSdk 28). Evidence, including screenshots and the
exact logcat lines, is in
[`device-reports/20261121-task8-demo-D1-D2.txt`](../device-reports/20261121-task8-demo-D1-D2.txt).

| Flow | D1 | D2 |
|---|---|---|
| One renderer kill | `escalate=false`, `REBUILD_NOW`; page returned, banner "Restored after a problem", editor usable | same |
| Second kill inside 60 s | `escalate=true`, `RECOVER_NOW`; native `RecoveryActivity` | same |
| `--ez forceCrash true` | `files/crash/last-crash.json` written; next launch opens `RecoveryActivity`; Share diagnostics opens the chooser; Restart returns to `MainActivity` | same (Share diagnostics not re-opened) |
| Back order | drawer → Settings → editor → leave | same |

The measured back order is drawer first, then the Settings sheet, because `back.ts` treats Settings as
a late layer (after the run sheet) and `back.test.ts` pins that. The procedure below previously said
the sheet closes first; that expectation was wrong and is corrected here.

### 1. Renderer kill recovers once, escalates on the second kill

```bash
adb -s <serial> install -r android/app/build/outputs/apk/debug/app-debug.apk
adb -s <serial> shell am force-stop dev.leocode
adb -s <serial> shell am start -n dev.leocode/.MainActivity
# wait for the editor, then find the WebView devtools socket:
adb -s <serial> shell cat /proc/net/unix | grep webview_devtools_remote
adb -s <serial> forward tcp:9333 localabstract:webview_devtools_remote_<pid>
node /tmp/opencode/cdp-eval.mjs --crash http://127.0.0.1:9333/json
# expected: toast + "Restored after a problem" banner, page usable again
# kill it a second time inside 60 s:
# expected: native RecoveryActivity ("Restored after a problem")
```

`Page.crash` is the CDP command; the existing `cdp-eval.mjs` helper prints the
renderer process exit. If the helper has no `--crash` mode, send
`{"id":1,"method":"Page.crash"}` over the page socket.

### 2. Forced crash opens RecoveryActivity on the next launch

```bash
adb -s <serial> shell am force-stop dev.leocode
adb -s <serial> shell am start -n dev.leocode/.MainActivity --ez forceCrash true
# the process dies; the handler writes files/crash/last-crash.json
adb -s <serial> shell am start -n dev.leocode/.MainActivity
# expected: native RecoveryActivity with Restart and Share diagnostics
# Restart -> editor; Share diagnostics -> chooser, text has <path> and <redacted>
```

Release builds ignore `forceCrash` (`BuildConfig.DEBUG` guard).

### 3. Back order

Open the sidebar, open the overflow menu and Settings, and switch to Terminal. Then:

1. Back closes the sidebar.
2. Back closes the Settings sheet.
3. Back returns from Terminal to the editor.
4. Back exits the app.

### 4. Insets

Rotate and open the keyboard in the terminal. The status bar and tab bar do not
overlap content; the tab bar rises above the keyboard. `--inset-top`,
`--inset-bottom`, `--ime-bottom` are visible in `chrome://inspect` or via CDP
`Runtime.evaluate`.

## Status

The code, unit tests, lint, APK builds and web checks pass, and the three device flows now pass on
D1 and D2 (2026-11-21), so Task 8 is `[x]` in `PROGRESS.md`. Insets were not re-measured in this
pass; the Phase B/C evidence stands. The first green GitHub CI run is recorded in
[`ci-first-run.md`](ci-first-run.md).
