# M1 redo: Tasks 31–33 on D1, with real evidence

Read [`README.md`](README.md) and [`reports/M1-D1-review.md`](reports/M1-D1-review.md) first.
No source changes. Don't commit. **Every PASS needs a screenshot that visibly shows the claimed
state, plus the raw logcat lines. If you can't get one, the row is FAIL or BLOCKED. Never PASS.**

## 0. Clean up and triage (stop after this step and report if anything is unexpected)

```bash
cd ~/Desktop/Apps/leocode
git branch --show-current; git log --oneline -3; git status --short   # expect phase-e-root, 8bcd255
adb -s 11f98015 shell dumpsys package dev.leocode | grep -E "versionCode|firstInstallTime|lastUpdateTime"
adb -s e76846f  shell dumpsys package dev.leocode | grep -E "versionCode|firstInstallTime|lastUpdateTime"
```

- D1: open `requirements.txt`, restore it to `# Add project dependencies here`, save it, and make
  sure no draft-recovery banner remains.
- D1 and D2: Settings › About › Diagnostics → screenshot the "runtimes" section of each.
- Report whether D1's `firstInstallTime` is after 2026-11-22 (data was wiped) and whether D2 still
  shows Python as installed and healthy.
  - D2 healthy and D1 reinstalled after 11-22 → data loss on D1; continue with step 1.
  - Both installed long ago and both "not installed" → **regression; STOP and report.**

## 1. Install the Python runtime on D1

Use the LAN proxy from HANDOFF (`adb reverse tcp:18080 tcp:18080`, proxy running on the host),
then Runtimes › Python 3 › Install. Screenshot `installed` + `healthy`, and the progress log.

## 2. Getting test files onto the phone (don't type code with `adb input text`)

`input text` strips quotes and spaces, and the editor auto-closes brackets. That is what mangled
the last run. Instead:

```bash
mkdir -p /tmp/m1 && cd /tmp/m1
printf 'x = input()\nprint("Got: " + x)\n' > stdin_test.py
printf 'def f():\n    return 1 / 0\n\nprint(f())\n' > zero.py
printf 'import unknown_package_xyz\n' > missing.py
adb -s 11f98015 shell mkdir -p /sdcard/Download/m1
adb -s 11f98015 push stdin_test.py zero.py missing.py /sdcard/Download/m1/
```

Then, in the app, Settings › Backup & Import › **Import folder** → `/sdcard/Download/m1` (ask the
owner to pick the folder in the system picker). Open the imported workspace. Screenshot the
Explorer showing the three files.

## 3. Rows. For each one, the screenshot must show what's in the "PASS when" column

| # | Steps | PASS when the screenshot shows |
|---|---|---|
| T31-1 | Open `stdin_test.py`, Run, type `LeoCode` in the stdin row (typing a plain word is fine), Send | Run sheet with `Got: LeoCode` in the output |
| T31-2 | Same run | Run sheet status line with the elapsed time and `exit 0` |
| T31-3 | Run `zero.py` | Error card "ZeroDivisionError" + a frame line for `zero.py`; then tap the frame → screenshot of the editor with the cursor on line 2 |
| T31-4 | Run `missing.py` | Error card for `ModuleNotFoundError` with the pip-install action |
| T32-1 | Terminal › Python REPL | Terminal showing the Python banner and `>>>` |
| T32-2 | `adb shell input text '1+1'` then `input keyevent 66` | `2` on the line after `>>> 1+1` |
| T32-3 | Tap `^D` on the key row | The shell prompt is back after the REPL |
| T33-1 | New file `t.py`; `input text 'def%sf():'`, `keyevent 66`, `input text 'return%s1'`, `keyevent 66` | The cursor on line 2 indented by 4 spaces (screenshot after the first Enter), and the line after `return 1` dedented (screenshot after the second) |
| T33-2 | Tap each snippet button `def`/`class`/`main`/`for`/`try` in an empty `.py` | The inserted text after each tap (5 screenshots, or one after all 5) |
| T33-4 | Runtimes › Compatibility | The sheet itself: the baseline section and the package list |

T33-3 (template) is already proven by the toast in the previous run; don't repeat it.

## 4. Logcat

`adb -s 11f98015 logcat -G 16M; logcat -c` before you start, then
`logcat -d | grep -E "LeoCode|chromium|Console" > docs/device-reports/20261125-task31-33-D1-logcat.txt`.
Paste **only real lines** into the report.

## 5. Output

- `docs/device-reports/20261125-task31-33-D1-11f98015.txt`: every command and its raw output.
- Screenshots in `docs/device-reports/20261125-task31-33-D1/`, named `<row>.png`.
- `docs/agent-briefs/reports/M1-D1-redo.md`: a table `row | PASS/FAIL/BLOCKED | screenshot | what it
  shows (one line)`, the step 0 triage findings, and the Chrome 80 console errors.
- Delete the rejected `docs/device-reports/20261124-task31-33-D1*` files and `reports/M1-D1.md`
  only after the owner agrees. Until then, leave them in place and uncommitted.
