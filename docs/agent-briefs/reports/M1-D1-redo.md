# M1 Redo Report — Tasks 31–33 on D1 (`11f98015`)

- **Date:** 2026-11-25
- **Device:** D1 (`11f98015`, Xiaomi Redmi Note 7S, Android 9 / SDK 28)
- **Build:** `dist/release/leocode-1011.apk` (`0.1.0-rc11`, `versionCode=1011`)
- **Branch / HEAD:** `feat/phase-g` (`2f4e4a0`)
- **Raw log:** [`docs/device-reports/20261125-task31-33-D1-11f98015.txt`](../../device-reports/20261125-task31-33-D1-11f98015.txt)
- **Logcat:** [`docs/device-reports/20261125-task31-33-D1-logcat.txt`](../../device-reports/20261125-task31-33-D1-logcat.txt)

## Step 0 Triage Findings

- **Git state:** Current branch is `feat/phase-g` at `2f4e4a0` (parent `8bcd255`), not `phase-e-root`.
- **Package timestamps:**
  - D1 (`11f98015`): `firstInstallTime=2026-11-22 17:08:16`, `lastUpdateTime=2026-11-24 22:57:39` (NOT reinstalled after 2026-11-22).
  - D2 (`192.168.29.118:40249`): `firstInstallTime=2026-11-22 17:43:50`, `lastUpdateTime=2026-11-24 20:28:59` (captured on 2026-11-24; D2 was unreachable when resuming on 2026-11-25, so D2 Diagnostics was not captured).
- **Cleanup & Runtime status:** `requirements.txt` on D1 was restored to `# Add project dependencies here` via Reload from disk with no draft banner. D1 Diagnostics reported `python 3.14.10 (versionCode 31410) installed=false healthy=false` prior to Step 1.
- **Step 1 & 2:** Installed Python `3.14.10` (`pip 26.2.2`, `python`/`pip` aliases) directly via Runtimes › Python 3 › Install (`step1-installing.png`, `step1-installed-details.png`, `step1-installed-healthy.png`), then pushed `stdin_test.py`, `zero.py`, `missing.py` to `/sdcard/Download/m1/` and imported `m1` via Settings › About › Import folder (`step2-explorer.png`).

## Results

| Row | Result | Screenshot | What it shows |
|---|---|---|---|
| T31-1 | **FAIL** | [`T31-1-running.png`](../../device-reports/20261125-task31-33-D1/T31-1-running.png) | `stdin_test.py` fails immediately (`FINISHED IN 316 MS (EXIT 1)`, `EOFError: EOF when reading a line`) because `ProcessSupervisor.kt` closes child stdin immediately; no stdin row or `Got: LeoCode` output. |
| T31-2 | **FAIL** | [`T31-1-running.png`](../../device-reports/20261125-task31-33-D1/T31-1-running.png) | Status line shows elapsed time (`FINISHED IN 316 MS`), but exits with `EXIT 1` (`EOFError`) instead of `exit 0`. |
| T31-3 | **FAIL** | [`T31-3-card.png`](../../device-reports/20261125-task31-33-D1/T31-3-card.png), [`T31-3-jump.png`](../../device-reports/20261125-task31-33-D1/T31-3-jump.png) | `ZeroDivisionError: Division by Zero` card and traceback are shown, but tapping the `zero.py` frame does not jump to line 2 (traceback has `/data/data/dev.leocode/...` while `workspaceRoot` is `/data/user/0/dev.leocode/...`, so no link is rendered). |
| T31-4 | **PASS** | [`T31-4.png`](../../device-reports/20261125-task31-33-D1/T31-4.png) | `ModuleNotFoundError` card (`Module "unknown_package_xyz" Not Found`) with `Suggestion: pip install unknown_package_xyz`. |
| T32-1 | **PASS** | [`T32-1.png`](../../device-reports/20261125-task31-33-D1/T32-1.png) | Terminal Python REPL shows `Python 3.14.10` banner and `>>> ` prompt. |
| T32-2 | **FAIL** | [`T32-2.png`](../../device-reports/20261125-task31-33-D1/T32-2.png) | REPL evaluated `1+1+11` → `13` (`adb shell input text '1+1'` duplicated `+11` in WebView IME) rather than `>>> 1+1` → `2`. |
| T32-3 | **PASS** | [`T32-3.png`](../../device-reports/20261125-task31-33-D1/T32-3.png) | Tapping `^D` exits Python REPL cleanly back to `:/data/data/dev.leocode/files/workspaces/default/m1 $`. |
| T33-1 | **FAIL** | [`T33-1-indent.png`](../../device-reports/20261125-task31-33-D1/T33-1-indent.png), [`T33-1-dedent.png`](../../device-reports/20261125-task31-33-D1/T33-1-dedent.png) | Enter after `def f():` indents 4 spaces, but Enter after `return 1` does not dedent (line 3 `x` stays indented 4 spaces). |
| T33-2 | **PASS** | [`T33-2.png`](../../device-reports/20261125-task31-33-D1/T33-2.png) | All 5 snippet buttons (`def`, `class`, `main`, `for`, `try`) insert their text into `t.py`. |
| T33-4 | **PASS** | [`T33-4.png`](../../device-reports/20261125-task31-33-D1/T33-4.png), [`T33-4-packages.png`](../../device-reports/20261125-task31-33-D1/T33-4-packages.png) | `Python Compatibility Matrix` sheet opens showing `Python Runtime Baseline` and `Tested Packages (9 of 9)`. |

## WebView Console Errors

- D1 WebView version reported in Diagnostics is `com.android.chrome 137.0.7151.115` (not Chrome 80).
- `Uncaught TypeError: Cannot read properties of null (reading 'style')` was **not** observed in `LeoCodeWeb` logcat during this run.
- Only `LeoCodeWeb` message logged:
  ```text
  11-25 13:03:53.144  3939  3939 D LeoCodeWeb: The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.  (https://appassets.androidplatform.net/assets/web/index.html?mode=system&theme=dark:14)
  ```
