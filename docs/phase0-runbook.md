# Phase 0 on-device runbook

Terse, repeatable. Devices per plan v9 (D-014): **D1** Redmi Note 7S (Android 9, unrooted) on
Wi-Fi ADB, **D2** custom ROM (Android 15, rooted) on USB.

## 1. Prepare the phone

### D1 — Redmi Note 7S (MIUI, Android 9)

1. Settings → About phone → tap MIUI version 7× → Developer options.
2. Developer options → **USB debugging** on.
3. Developer options → **Install via USB** on.
4. Developer options → **USB debugging (Security settings)** on (may require a signed-in Mi account).
5. Battery → App battery saver → LeoCode → **No restrictions**.
6. Security → Autostart → LeoCode on.
7. USB mode: File transfer (not "charging only").

### D2 — custom ROM (Android 15, rooted)

1. Settings → About phone → tap Build number 7× → Developer options.
2. Developer options → **USB debugging** on (and **Wireless debugging** if D2 is the wireless one).
3. Root manager (Magisk / KernelSU / ROM `su`): do **not** pre-grant LeoCode. Root is opt-in from
   inside the app (D-011). To test "unrooted Android 15", deny or revoke LeoCode there.
4. Battery → LeoCode → Unrestricted.
5. Record the ROM name, root manager and version in `docs/test-matrix.md`.

### Both phones on one cable (Wi-Fi ADB for D1)

Same home network for laptop and D1:

```bash
adb devices -l                               # D1 on USB
adb -s <d1-usb-serial> tcpip 5555
adb -s <d1-usb-serial> shell ip addr show wlan0   # note the inet address
adb connect <d1-ip>:5555
# unplug D1, plug in D2
adb devices -l                               # both listed: <d1-ip>:5555 and D2's serial
export LEO_D1=<d1-ip>:5555 LEO_D2=<d2-serial>
```

Re-run `adb tcpip 5555` over USB after every D1 reboot. Always pass `-s "$LEO_D1"` or
`-s "$LEO_D2"` once both are connected. If Wi-Fi ADB is unreliable, use one phone at a time.

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

Copy each result into `docs/test-matrix.md`, then repeat on D2 (`adb -s "$LEO_D2" …`).

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
| Install refused on D2 (`INSTALL_FAILED_DEPRECATED_SDK_VERSION`) | targetSdk below the Android install floor | record it; plan v9 §14 |
| PTY lib fails to load on D2 | 16 KB page device + unaligned `.so` | check `PAGE_SIZE`; Task 2 alignment |
| Jobs die when D2 is backgrounded | Android 12+ phantom-process killer | Task 10; note behaviour in the matrix |

## 7. Hand-off

Once T1–T6 pass on D2, the restructure (plan v9 Phase B) starts. The CPython package targets the
confirmed ABI and page size (Task 24).
