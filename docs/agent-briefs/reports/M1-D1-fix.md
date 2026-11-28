# M1 fix pass — Tasks 31–33 re-verified on D1 (spot-checked on D2)

- **Date:** 2026-11-28
- **Device:** D1 (`11f98015`, Xiaomi Redmi Note 7S, Android 9 / SDK 28, 1080x2340)
- **Build:** `dist/release/leocode-1013.apk` (`0.1.0-rc13`, `versionCode=1013`),
  sha256 `b1f8715e49e8394f0651dc44cf28170ba44f756a7f7547dfa85559681dd4e90e`, 18 942 467 bytes
- **Branch:** `feat/phase-g` at `bdd5ece` + this uncommitted fix pass
- **Raw log:** [`docs/device-reports/20261128-fix-D1-11f98015.txt`](../../device-reports/20261128-fix-D1-11f98015.txt)
- **Logcat:** [`docs/device-reports/20261128-fix-D1-11f98015-logcat.txt`](../../device-reports/20261128-fix-D1-11f98015-logcat.txt)
- **Supersedes:** the four FAIL rows in [`M1-D1-redo.md`](M1-D1-redo.md) (rc11).

## Root causes and fixes

| Failure | Root cause | Fix |
|---|---|---|
| T31-1/T31-2 stdin | `ProcessSupervisor` closed the child's stdin immediately after `start()` (the B-07 hang guard), so `input()` raised `EOFError` in ~300 ms. | Added `ProcessSpec.stdin` (default `false`, so every other call site keeps the B-07 guard). `proc.run` accepts `stdin`; new `proc.stdin { jobId, data } → { written }` writes UTF-8 to the live pipe under a per-job lock and closes it when the job exits. `runStore.runFile` requests `stdin: true`; `AndroidBridge` exposes `handle.write`; the Run sheet renders a stdin field plus Send while running. |
| T31-3 jump | Python reported `/data/data/dev.leocode/...` while `AppInfo.workspaceRoot` is `/data/user/0/dev.leocode/...`, so `isInsideWorkspace` returned false and no link was rendered. The frame regex also only matched `", line ` and re-rendered the suffix. | Canonicalize `/data/user/<uid>/` ↔ `/data/data/` in `isInsideWorkspace`/`toWorkspacePath`; accept `", line N, in f"` (and any whitespace); `RunSheet` falls back to the active workspace path and jumps through `runStore.jumpToFile` (open file, go to line, switch to Editor). |
| T33-1 dedent | `@codemirror/lang-python`'s own `indentService` outranked the custom one, so only its indent rule ran and the custom dedent rule never executed. | `Prec.high(indentService.of(pythonIndentService))`, and handle `context.simulatedBreak` so Enter-after-`return 1` is evaluated against the simulated split line. |
| T32-2 | Not a product bug: `adb shell input text '1+1'` duplicated characters through the WebView IME (`1+1` became `1+1+11`). | Re-ran with key events (`KEYCODE_1`, `KEYCODE_PLUS`, `KEYCODE_1`) and verified the field before Enter. No source change. |

The error card was also unstyled on device (`.run-error-*` classes had no CSS), which made
the T31-3 card unreadable; `web/src/styles/run.css` now styles the card, badge, title,
description, pip action and traceback links.

## Results (D1, rc13)

| Row | Result | Evidence | What the screenshot shows |
|---|---|---|---|
| T31-1 | **PASS** | [`T31-1-stdin-rc13.png`](../../device-reports/20261128-fix-D1-T31-1-stdin-rc13.png) | `stdin_test.py` stayed running, the stdin row accepted `LeoCode`, output is `LeoCode` / `Got: LeoCode`. |
| T31-2 | **PASS** | [`T31-1-stdin-rc13.png`](../../device-reports/20261128-fix-D1-T31-1-stdin-rc13.png) | Status line `FINISHED IN 28.1 S (EXIT 0)`. |
| T31-3 | **PASS** | [`T31-3-card-styled.png`](../../device-reports/20261128-fix-D1-T31-3-card-styled.png), [`T31-3-jump-rc13.png`](../../device-reports/20261128-fix-D1-T31-3-jump-rc13.png) | `ZeroDivisionError` / `Division by Zero` card with linked `zero.py` frames; tapping the line-2 frame opens `m1/zero.py` with line 2 highlighted. |
| T31-4 | **PASS** | [`T31-4-missing-rc13.png`](../../device-reports/20261128-fix-D1-T31-4-missing-rc13.png) | `ModuleNotFoundError` card, `Module "unknown_package_xyz" Not Found`, `pip install unknown_package_xyz`. |
| T32-1 | **PASS** | [`T32-2-repl.png`](../../device-reports/20261128-fix-D1-T32-2-repl.png) | `Python 3.14.10` banner and `>>>` prompt. |
| T32-2 | **PASS** | [`T32-2-repl.png`](../../device-reports/20261128-fix-D1-T32-2-repl.png) | `>>> 1+1` → `2`, with a fresh `>>>` on the next line. |
| T32-3 | **PASS** | [`T32-3-exit-rc13.png`](../../device-reports/20261128-fix-D1-T32-3-exit-rc13.png) | `^D` closes the REPL; shell prompt `:/data/data/dev.leocode/files/workspaces/default $` is back. |
| T33-1 | **PASS** | [`T33-1-indent-rc13.png`](../../device-reports/20261128-fix-D1-T33-1-indent-rc13.png), [`T33-1-dedent-rc13.png`](../../device-reports/20261128-fix-D1-T33-1-dedent-rc13.png) | `def f():` → line 2 `    return 1`; Enter after it puts line 3 at column 0. |
| T33-2 | **PASS** | [`T33-2-snippets-rc13.png`](../../device-reports/20261128-fix-D1-T33-2-snippets-rc13.png) | All five snippet buttons inserted: `def class if __name__ == "__main__":` / `    for try:`. |
| T33-4 | **PASS** | [`T33-4-baseline-rc13.png`](../../device-reports/20261128-fix-D1-T33-4-baseline-rc13.png), [`T33-4-packages-rc13.png`](../../device-reports/20261128-fix-D1-T33-4-packages-rc13.png) | `Python Compatibility Matrix` with `Python Runtime Baseline` and `Tested Packages (9 of 9)`. |

T33-3 (template) is unchanged and remains covered by the rc11 toast evidence.

## Logcat

`adb -s 11f98015 logcat -d | grep -E "LeoCode|chromium|Console"` produced 1261 lines
(Chromium `FlagStore`/Cronet noise from Chrome and Play services). The only LeoCode lines are the
existing informational CSP message, one per app start:

```text
11-28 12:11:16.820  8119  8119 D LeoCodeWeb: The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.  (https://appassets.androidplatform.net/assets/web/index.html?mode=system&theme=dark:14)
11-28 12:41:25.471 11426 11426 D LeoCodeWeb: The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.  (https://appassets.androidplatform.net/assets/web/index.html?mode=system&theme=dark:14)
```

No `Uncaught`/console errors were logged for the app.

## Gates

- Web: 63 test files / 504 tests pass; `tsc --noEmit` clean; `eslint .` clean; `vite build` clean.
- Android: 523 unit tests, 0 failures, 1 skipped; `lintDebug` clean.
- Web bundle re-synced into `android/app/src/main/assets/web`.

## D2 (POCO F1) spot check

rc13 installed on D2; `versionCode=1013` / `0.1.0-rc13` confirmed. Python 3.14.10 was missing
from the earlier D2 install and was re-installed from Runtimes first. The Wi-Fi ADB address
changed during the pass (`10.8.0.247:40061` → `10.8.0.62:40061`); the session was reconnected
and the checks finished. Raw log:
[`docs/device-reports/20261128-fix-D2.txt`](../../device-reports/20261128-fix-D2.txt).

| Row | Result | Evidence | What the screenshot shows |
|---|---|---|---|
| T31-1/T31-2 | **PASS** | [`T31-1-stdin-rc13.png`](../../device-reports/20261128-fix-D2-T31-1-stdin-rc13.png) | `d2stdin.py` accepted `D2Code`; `FINISHED IN 110.1 S (EXIT 0)`; output `D2Code` / `D2Code`. |
| T31-3 | **PASS** | [`T31-3-card-rc13.png`](../../device-reports/20261128-fix-D2-T31-3-card-rc13.png), [`T31-3-jump-rc13.png`](../../device-reports/20261128-fix-D2-T31-3-jump-rc13.png) | Styled `ZeroDivisionError` card with linked `/data/user/0/...` frames; tapping the line-2 frame opens `zero.py` with the cursor on line 2. |
| T32-1/T32-2 | **PASS** | [`T32-2-repl-rc13.png`](../../device-reports/20261128-fix-D2-T32-2-repl-rc13.png) | Python 3.14.10 banner, `>>> 1+1` → `2`. |
| T32-3 | **PASS** | [`T32-3-exit-rc13.png`](../../device-reports/20261128-fix-D2-T32-3-exit-rc13.png) | `^D` returns to the shell prompt. |
| T33-1 | **PASS** | [`T33-1-indent-rc13.png`](../../device-reports/20261128-fix-D2-T33-1-indent-rc13.png), [`T33-1-dedent-rc13.png`](../../device-reports/20261128-fix-D2-T33-1-dedent-rc13.png) | `def f():` → `    return 1`; Enter puts line 3 at column 0. |
| T33-2 | **PASS** | [`T33-2-snippets-rc13.png`](../../device-reports/20261128-fix-D2-T33-2-snippets-rc13.png) | `def class if __name__ == "__main__":` / `    for try:` inserted from the snippet row. |
| T33-4 | **PASS** | [`T33-4-baseline-rc13.png`](../../device-reports/20261128-fix-D2-T33-4-baseline-rc13.png), [`T33-4-packages-rc13.png`](../../device-reports/20261128-fix-D2-T33-4-packages-rc13.png) | `Python Compatibility Matrix`, runtime baseline and the package table with PASS/UNTESTED/UNSUPPORTED badges. |

D2 logcat after a clean start contains only `LeoCodeSecrets`, the informational `LeoCodeWeb`
CSP line and `LeoCodeRoot` status; no `Uncaught`/console errors.
