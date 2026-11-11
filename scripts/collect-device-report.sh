#!/usr/bin/env bash
# Capture a device report (plan v9 Task 3).
#
#   scripts/collect-device-report.sh [serial] [output-file]
#
# With two phones connected always pass the serial (or set LEO_D1 / LEO_D2);
# scripts/devices.sh prints the serials and the matching exports.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
adb="${ADB:-adb}"

serial="${1:-${LEO_D1:-}}"
if [ -z "$serial" ]; then
  mapfile -t connected < <("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  if [ ${#connected[@]} -eq 1 ]; then
    serial="${connected[0]}"
  elif [ ${#connected[@]} -eq 0 ]; then
    echo "No device. Enable USB debugging and check 'adb devices -l'." >&2
    exit 1
  else
    echo "Several devices connected. Pass a serial:" >&2
    printf '  %s\n' "${connected[@]}" >&2
    exit 2
  fi
fi

if ! "$adb" -s "$serial" get-state >/dev/null 2>&1; then
  echo "error: device '$serial' is not connected" >&2
  exit 1
fi

OUT="${2:-$root/docs/device-reports/$(date +%Y%m%d-%H%M%S)-device.txt}"
mkdir -p "$(dirname "$OUT")"

run() { "$adb" -s "$serial" shell "$@" 2>/dev/null | tr -d '\r'; }

props() {
  for p in "$@"; do
    printf '%-30s %s\n' "$p" "$(run getprop "$p")"
  done
}

{
  echo "# LeoCode device report"
  echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "serial:    $serial"
  echo
  echo "## identity"
  props ro.product.manufacturer ro.product.model ro.product.device \
        ro.build.version.release ro.build.version.sdk ro.build.version.security_patch \
        ro.build.display.id ro.build.flavor ro.boot.selinux \
        ro.miui.ui.version.name ro.miui.ui.version.code

  echo
  echo "## cpu / abi"
  props ro.product.cpu.abi ro.product.cpu.abilist ro.product.cpu.abilist32 \
        ro.product.cpu.abilist64

  echo
  echo "## memory / storage"
  run cat /proc/meminfo | head -5
  echo
  run df -h /data | tail -2

  echo
  echo "## page size"
  run getconf PAGE_SIZE
  auxv_hex="$(run 'od -An -tx8 -v /proc/self/auxv | tr -s " " "\n" | awk "p{print; exit} /^0*6\$/{p=1}"' | tr -d ' ')"
  if [ -n "$auxv_hex" ]; then
    echo "auxv AT_PAGESZ: $((16#$auxv_hex))"
  fi

  echo
  echo "## webview"
  run dumpsys webviewupdate | sed -n '1,24p'
  for pkg in com.google.android.webview com.android.webview com.google.android.trichromelibrary; do
    line="$(run dumpsys package "$pkg" | grep -m1 -E 'versionName=')"
    printf '%-34s %s\n' "$pkg" "${line:-<not installed>}"
  done

  echo
  echo "## app"
  run dumpsys package dev.leocode | grep -E 'versionName|versionCode|targetSdk|minSdk' | head -8

  echo
  echo "## root"
  su_path="$(run 'command -v su')"
  printf '%-30s %s\n' "su binary" "${su_path:-<none>}"
  if [ -n "$su_path" ]; then
    printf '%-30s %s\n' "su -c id" "$(timeout 6 "$adb" -s "$serial" shell 'su -c id </dev/null' 2>/dev/null | tr -d '\r' | tr '\n' ' ')"
  fi

  echo
  echo "## storage permission state"
  run dumpsys package dev.leocode | grep -E 'READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE' | head -8

  echo
  echo "## system shell"
  run ls /system/bin | tr '\n' ' ' | fold -s -w 100 | head -8
  echo
  for t in setsid tar gzip unzip sed awk grep find xxd curl git python su; do
    if [ -n "$(run "command -v $t")" ]; then echo "yes $t"; else echo "no  $t"; fi
  done

  echo
  echo "## adb"
  "$adb" devices -l | tr -d '\r'
} | tee "$OUT"

echo
echo "written: ${OUT#$root/}"
