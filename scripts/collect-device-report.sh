#!/usr/bin/env bash
# Phase 0A: capture a device report. Run with one phone connected.
#   scripts/collect-device-report.sh [output-file]
set -uo pipefail

OUT="${1:-docs/device-reports/$(date +%Y%m%d-%H%M%S)-device.txt}"
mkdir -p "$(dirname "$OUT")"

if ! adb get-state >/dev/null 2>&1; then
  echo "No device. Enable USB debugging and check 'adb devices -l'." >&2
  exit 1
fi

props() {
  for p in "$@"; do
    printf '%-28s %s\n' "$p" "$(adb shell getprop "$p" 2>/dev/null | tr -d '\r')"
  done
}

{
  echo "# LeoCode device report"
  echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "## identity"
  props ro.product.manufacturer ro.product.model ro.product.device \
        ro.build.version.release ro.build.version.sdk ro.build.version.security_patch \
        ro.boot.selinux ro.miui.ui.version.name ro.miui.ui.version.code

  echo
  echo "## cpu / abi"
  props ro.product.cpu.abi ro.product.cpu.abilist ro.product.cpu.abilist32 \
        ro.product.cpu.abilist64 ro.build.version.sdk_int

  echo
  echo "## memory / storage"
  adb shell cat /proc/meminfo | head -5
  echo
  adb shell df -h /data | tail -2

  echo
  echo "## page size"
  adb shell getconf PAGE_SIZE 2>/dev/null || echo "getconf unavailable (use native helper)"

  echo
  echo "## webview"
  adb shell dumpsys webviewupdate 2>/dev/null | sed -n '1,24p'
  adb shell dumpsys package com.google.android.webview 2>/dev/null \
    | grep -iE 'versionName|versionCode' | head -4

  echo
  echo "## system shell"
  adb shell ls /system/bin | tr '\n' ' ' | fold -s -w 100 | head -8
  echo
  for t in setsid tar gzip unzip sed awk grep find xxd curl git python; do
    if adb shell "command -v $t" >/dev/null 2>&1; then echo "yes $t"; else echo "no  $t"; fi
  done

  echo
  echo "## adb"
  adb devices -l
} | tee "$OUT"

echo
echo "written: $OUT"
