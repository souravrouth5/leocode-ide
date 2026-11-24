# Phase E device pass: root mode on D2 (rooted) and D1 (unrooted)

Read [`README.md`](README.md) first. This is **not** a code brief. **Do not change any source
file.** If a row fails, record it and keep going (unless it blocks the rows after it). The review
decides the fixes.

The owner is at the laptop, with D2 in hand. **Ask the owner** whenever a step needs a tap you
can't do over adb: Magisk Grant/Deny prompts, or WebView UI elements that `uiautomator` doesn't
expose. Say exactly what to tap, wait for "done", then take a screenshot.

## 0. Preconditions

```bash
cd ~/Desktop/Apps/leocode
git status --short; git log --oneline -3     # HEAD must include cf31792 "B4/B5 review fixes"
adb devices -l                               # D2 e76846f (USB), D1 11f98015 or Wi-Fi
adb -s e76846f shell svc power stayon true
adb -s e76846f logcat -G 16M; adb -s e76846f logcat -c
UID_LC=$(adb -s e76846f shell dumpsys package dev.leocode | grep -m1 -o 'userId=[0-9]*' | cut -d= -f2)
adb -s e76846f shell su -c id                # must print uid=0; if not, ask the owner to allow "Shell" in Magisk
```

**Never `pm clear` or uninstall LeoCode.** That wipes the Python runtime, workspaces and SSH keys.

## 1. Install the Phase E build

The phones run the release-signed `leocode-1009`. A debug APK can't install over it
(`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). Build a release-signed rc10 from this branch instead.
This also checks Phase E under R8:

```bash
scripts/build-release.sh 0.1.0-rc10 1010 https://github.com/souravrouth5/leocode-ide/releases/download/rc/release.json
APK=dist/release/leocode-1010.apk            # check the path the script prints
scripts/smoke.sh e76846f "$APK"              # install -r + cold start + logcat
scripts/smoke.sh <D1-serial> "$APK"
```

Confirm `versionCode=1010` on both phones. If the build script fails, stop and report.

## 2. Magisk policy for LeoCode (D2)

Run as `adb -s e76846f shell su -c "magisk --sqlite '<SQL>'"`:

| State | SQL |
|---|---|
| allow | `UPDATE policies SET policy=2 WHERE uid=$UID_LC` |
| deny | `UPDATE policies SET policy=1 WHERE uid=$UID_LC` |
| prompt (ask) | `DELETE FROM policies WHERE uid=$UID_LC` (the next grant needs the owner to tap Grant) |
| show | `SELECT uid,policy FROM policies WHERE uid=$UID_LC` |

If the schema differs on this Magisk version, ask the owner to switch it in Magisk › Superuser ›
LeoCode. Log the policy state before every row.

## 3. Useful checks

```bash
LEAK='su -c "ps -A -o PID,PGID,USER,NAME | grep -E \"sleep (60[01]|900)\" | grep -v grep"'
adb -s e76846f shell "$LEAK"                                         # empty = no leak
adb -s e76846f shell su -c "ls -lZ /data/data/dev.leocode/files/run/root/"
adb -s e76846f shell su -c "cat /data/data/dev.leocode/files/run/root/*.pid"
adb -s e76846f logcat -d -s LeoCodeRoot:* LeoCodeProc:* LeoCodePty:* | tail -40
adb -s e76846f exec-out screencap -p > docs/device-reports/20261124-phaseE/<row>.png
```

To create a test script in the active workspace, use the app's New File, or ask the owner.
Release builds have no `run-as`.

## 4. Rows (D2 unless marked)

| # | Row | Steps | PASS when |
|---|---|---|---|
| E-00 | **Root pidfile works** (B1/B3 depend on it) | Policy allow. Root mode on. Terminal › Root Shell. | `files/run/root/<id>.pid` exists, mode `-rw-r--r--`, content `"<pid> <start>"`; `su -c "ps -o PID,PGID,USER,NAME -p <pid>"` shows a root `sh`; logcat has **no** "Root pid unknown" |
| E-01 | No `su` prompt at startup | Root mode on, policy **prompt**. `am force-stop dev.leocode`, launch, wait 10 s, open Settings. | No Magisk prompt appears; Diagnostics says "root mode enabled (not verified this session)" |
| E-13 | Status/Diagnostics never prompt | Same state as E-01: open Settings › Advanced and Diagnostics 3× each. | No prompt |
| E-02 | **D1:** "Root not available" | D1 Settings › Advanced. | Toggle disabled with the message; no `su` calls in logcat |
| E-03 | Enable → warning → grant → chip | Disable root mode. Enable → **Cancel** the warning (nothing changes) → enable again → accept → owner taps **Grant**. | `ROOT MODE` chip in the header; `root.status` log `granted=true` |
| E-04 | Grant denied → sheet + Try again | Disable root mode; policy **deny**; enable + accept. | `E_ROOT_DENIED` sheet with **Try again**; toggle off |
| E-06 | Root shell is uid 0 | Policy allow. Root Shell, type `id; echo $$`. | Screenshot shows `uid=0(root)`; the `$$` matches the pidfile pid |
| E-07 | Run as root: output + exit code | Script `id -u; exit 3`, Run as root. | Output `0`, `EXIT 3`, `# ROOT` badge while running |
| E-09 | `# ROOT` only while alive | During E-07/E-08. | `# ROOT` in run bar/status bar only while running; header chip stays |
| E-08 | **Stop root job leaves no process** | Run as root `sleep 600` → Stop. Then Root Shell, `sleep 600`, tap **Exit Root Shell**. | `$LEAK` empty both times; the pidfile is gone |
| E-16 | Root kill reaches children | Run as root `sleep 600 & sleep 601 & wait` → Stop. | `$LEAK` empty (if not, record the PGID column of the leftovers) |
| E-17 | Early Stop doesn't leak | Run as root `sleep 600`, Stop within 0.5 s. Do it 3×. | `$LEAK` empty every time |
| E-05 | Revoke → next root op refused | Policy allow; open root shell A (`id`). Policy **deny**; open root shell B; Run as root `id`. | B and the run show the "Root access was refused" banner; logcat `root.lost` with `reason=denied`; **shell A still works as uid 0** (documented) |
| E-18 | Try again keeps open root shells | Continue from E-05: in shell A run `sleep 900`. Policy **allow**, tap **Try again**. | Grant succeeds; shell A and `sleep 900` still alive (`$LEAK` shows it); then kill it via Exit Root Shell |
| E-11 | Root orphan reaped on next root use | Run as root `sleep 600`; `am force-stop dev.leocode`. Check `$LEAK` (still alive is expected). Relaunch (no prompt), open Root Shell. | Within ~3 s `$LEAK` is empty and the old pidfile is gone |
| E-12 | Disable persists | Disable root mode; force-stop; relaunch. | Toggle off, no chip; any open root work ended at disable |
| E-14 | Phantom-process option | **Ask the owner first** (it changes device config until reboot). Root on, Settings › Apply until reboot › Apply. | Read-back `2147483647`; `adb shell device_config get activity_manager max_phantom_processes` agrees |
| E-15 | Pending prompt doesn't hang the UI | Policy **prompt**; disable + enable + accept; owner does **not** tap for 40 s, but opens the drawer/editor meanwhile. | UI stays responsive; the request ends with `E_ROOT_DENIED` (Magisk auto-denies after its own timeout, or ours fires at 30 s); record which happened and the time |
| E-10 | `su` denied: everything else unchanged | Policy deny. D2: `scripts/smoke.sh`, open a terminal, run a `.py`, Git tab status. **D1:** the same. | All work; no root prompts |

Leave D2 at policy **allow** and root mode **on** at the end. Turn `stayon` off.

## 5. Evidence and report

- One raw text log per phone: `docs/device-reports/20261124-phaseE-D2-e76846f.txt` and
  `docs/device-reports/20261124-phaseE-D1-<serial>.txt`. Record every command and its output, the
  Magisk policy before each row, the logcat excerpts, and PASS/FAIL per row.
- Screenshots go in `docs/device-reports/20261124-phaseE/`.
- Report: `docs/agent-briefs/reports/DEVICE-phaseE.md`, with a table `row | D2 | D1 | evidence line
  or screenshot | note`, then each FAIL with exact output, and anything surprising.
- **Don't commit.** Don't edit `test-matrix.md` or `PROGRESS.md` (that happens after review).
