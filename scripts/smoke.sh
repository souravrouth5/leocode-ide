#!/usr/bin/env bash
# Install, launch and measure one device (plan v9 §12, Task 3).
#
#   scripts/smoke.sh <serial> [apk]
#
# Installs the APK (default: the debug build), force-stops the app, starts it
# cold with `am start -W`, then records cold-start timing and a focused logcat
# to docs/device-reports/. Exit code is non-zero if the launch fails.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
adb="${ADB:-adb}"

serial="${1:-${LEO_D1:-}}"
apk="${2:-$root/android/app/build/outputs/apk/debug/app-debug.apk}"

if [ -z "$serial" ]; then
  echo "usage: scripts/smoke.sh <serial> [apk]" >&2
  echo "       scripts/devices.sh shows the serials" >&2
  exit 2
fi
if ! "$adb" -s "$serial" get-state >/dev/null 2>&1; then
  echo "error: device '$serial' is not connected (adb devices -l)" >&2
  exit 2
fi
if [ ! -f "$apk" ]; then
  echo "error: APK not found: $apk" >&2
  echo "       build it: (cd android && ./gradlew assembleDebug)" >&2
  exit 2
fi

model="$("$adb" -s "$serial" shell getprop ro.product.model 2>/dev/null | tr -d '\r')"
api="$("$adb" -s "$serial" shell getprop ro.build.version.sdk 2>/dev/null | tr -d '\r')"
stamp="$(date +%Y%m%d-%H%M%S)"
out="$root/docs/device-reports/${stamp}-smoke-${serial//[:\/]/_}.txt"
mkdir -p "$(dirname "$out")"

echo "== $model (API $api) · $serial"
echo "== apk: $apk"

echo "== install"
if ! "$adb" -s "$serial" install -r "$apk"; then
  echo "FAIL install (MIUI: enable 'Install via USB'; Android 15: targetSdk floor?)" | tee -a "$out"
  exit 1
fi

"$adb" -s "$serial" logcat -c 2>/dev/null || true
# A locked or sleeping screen prevents the activity from reaching first frame.
"$adb" -s "$serial" shell input keyevent KEYCODE_WAKEUP 2>/dev/null || true
"$adb" -s "$serial" shell wm dismiss-keyguard 2>/dev/null || true
"$adb" -s "$serial" shell am force-stop dev.leocode
sleep 0.5

echo "== cold start (am start -W)"
start_out="$("$adb" -s "$serial" shell am start -W -n dev.leocode/.MainActivity 2>&1 | tr -d '\r')"
echo "$start_out"

status="$(printf '%s\n' "$start_out" | sed -n 's/^Status: //p')"
total="$(printf '%s\n' "$start_out" | sed -n 's/^TotalTime: //p')"
wait_time="$(printf '%s\n' "$start_out" | sed -n 's/^WaitTime: //p')"
launch_state="$(printf '%s\n' "$start_out" | sed -n 's/^LaunchState: //p')"

sleep 2
pid="$("$adb" -s "$serial" shell pidof dev.leocode 2>/dev/null | tr -d '\r')"

# Focused logcat: app tags plus crashes. Avoids multi-MB dumps on a phone.
log_tmp="$(mktemp)"
"$adb" -s "$serial" logcat -d -v time \
  -s LeoCode:V LeoCodeWeb:V LeoCodeHarness:I AndroidRuntime:E libc:E DEBUG:E '*:S' \
  >"$log_tmp" 2>&1 || true

{
  echo "# LeoCode smoke test"
  echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "serial:    $serial"
  echo "model:     $model"
  echo "api:       $api"
  echo "apk:       $apk"
  echo
  echo "## am start -W"
  printf '%s\n' "$start_out"
  echo
  echo "## verdict"
  echo "pid:        ${pid:-<none>}"
  echo
  echo "## logcat"
  cat "$log_tmp"
} >"$out"
rm -f "$log_tmp"

echo
echo "== result"
echo "Status:      ${status:-?}"
echo "LaunchState: ${launch_state:-?}"
echo "TotalTime:   ${total:-?} ms"
echo "WaitTime:    ${wait_time:-?} ms"
echo "pid:         ${pid:-<none>}"
echo "logcat:      ${out#$root/}"

if [ "$status" != "ok" ] || [ -z "$pid" ] || [ -z "$total" ]; then
  echo "FAIL — app did not stay running (see the logcat file)"
  exit 1
fi
echo "PASS — launched cold in ${total} ms"
