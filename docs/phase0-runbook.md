# Phase 0 on-device runbook

Terse, repeatable. Everything here is a gate for building any UI.

## 1. Prepare the phone

Redmi Note 7S (MIUI, Android 9):

1. Settings → About phone → tap MIUI version 7× → Developer options.
2. Developer options → **USB debugging** on.
3. Developer options → **Install via USB** on.
4. Developer options → **USB debugging (Security settings)** on (may require a signed-in Mi account).
5. Battery → App battery saver → LeoCode → **No restrictions**.
6. Security → Autostart → LeoCode on.
7. USB mode: File transfer (not "charging only").

```bash
adb devices -l        # must list one device as "device", not "unauthorized"
```

## 2. Capture the device report

```bash
scripts/collect-device-report.sh
```

Check by hand:

- `abilist` contains `arm64-v8a`
- WebView `versionName` ≥ `100.x`
- `PAGE_SIZE` is 4096 (note it even if 16384)
- `command -v setsid` → yes

## 3. Build and install

```bash
export JAVA_HOME="$HOME/jdk17"          # JDK 21 here is a JRE: no jlink, AGP fails
export ANDROID_HOME="$HOME/Android/Sdk"
cd android
./gradlew assembleDebug                # or /tmp/opencode/gradle-8.9/bin/gradle
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

If install fails with `INSTALL_FAILED_USER_RESTRICTED`, the MIUI "Install via USB" toggle is off.

## 4. Run the harness

Fast path — run everything from the laptop and read it back from logcat:

```bash
adb logcat -c
adb shell am force-stop dev.leocode
adb shell am start -n dev.leocode/.MainActivity --es run all
sleep 90
adb logcat -d -s LeoCodeHarness:I | sed 's/^.*LeoCodeHarness: //'
```

Single test: `--es run T2` (ids `T1`…`T7`). The UI's **Run all** button does the same and
writes the same logcat lines.

| Button | Pass condition |
|---|---|
| T1 sh | exit 0, prints `hello-from-android` |
| T2 exec | prints `exec-from-data-ok` (this is the W^X gate) |
| T3 kill | `exited=yes` within 5 s |
| T4 exit | `exit=42` and stderr captured |
| T5 flood | `truncated=true`, `timedOut=false`, exit 0 (25 MB; takes ~45 s on the Redmi) |
| T6 pty | `pty-ok` and `exit=7` |
| T7 toybox | inventory saved for the compatibility notes |

Copy each result into `docs/test-matrix.md`, then repeat on the Android 11 phone.

## 5. Logs

```bash
adb logcat -c && adb logcat | grep -iE 'leocode|AndroidRuntime|libc'
```

Useful checks:

```bash
adb shell dumpsys webviewupdate
adb shell dumpsys package dev.leocode | grep -E 'versionName|targetSdk'
adb shell am force-stop dev.leocode
```

## 6. Failure playbook

| Symptom | Likely cause | Do |
|---|---|---|
| T2 exit 126/127, `Permission denied` | targetSdk ≥ 29 or `/data` noexec | confirm `targetSdk 28` in the merged manifest |
| T2 `cannot execute: required file not found` | binary's interpreter path wrong | copy a *static* toybox binary instead |
| T3 never exits | `setsid` missing / wrong pid | use the PTY path (`T6`) and kill the group from there |
| T6 native lib not loaded | ABI mismatch or NDK build skipped | check `lib/arm64-v8a/libleocodepty.so` is in the APK |
| App killed when backgrounded | MIUI battery policy | follow step 1.5–1.6, then retest |
| WebView report missing | no WebView provider | set up Play Store / Android System WebView |

## 7. Hand-off to Phase 0C

Once T1–T6 pass, send the device report + test matrix; the CPython build then targets the
confirmed ABI and page size.
