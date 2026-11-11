#!/usr/bin/env bash
# Resolve and describe the two test devices (plan v9 §12, Task 3).
#
#   scripts/devices.sh            # table + ready-to-paste exports
#   eval "$(scripts/devices.sh --exports)"   # only the export lines
#
# Resolution order:
#   1. LEO_D1 / LEO_D2 from the environment, when those serials are connected;
#   2. otherwise auto-detect: with exactly two devices, the lower Android API is
#      D1 (old-Android baseline) and the higher is D2 (new Android).
#
# Wi-Fi ADB for D1 (both phones on one cable):
#   adb -s <d1-usb-serial> tcpip 5555
#   adb -s <d1-usb-serial> shell ip addr show wlan0     # note the inet address
#   adb connect <d1-ip>:5555
#   # unplug D1, plug in D2; re-run `adb tcpip 5555` after every D1 reboot.
set -uo pipefail

adb="${ADB:-adb}"
mode="${1:-table}"

connected=()
while IFS= read -r serial; do
  [ -n "$serial" ] && connected+=("$serial")
done < <("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1 }')

if [ ${#connected[@]} -eq 0 ]; then
  echo "No devices in 'device' state. Run: adb devices -l" >&2
  exit 1
fi

is_connected() {
  local serial="$1"
  for s in "${connected[@]}"; do
    [ "$s" = "$serial" ] && return 0
  done
  return 1
}

prop() {
  "$adb" -s "$1" shell getprop "$2" 2>/dev/null | tr -d '\r'
}

api_of() {
  local api
  api="$(prop "$1" ro.build.version.sdk)"
  [ -n "$api" ] || api=0
  printf '%s' "$api"
}

d1="${LEO_D1:-}"
d2="${LEO_D2:-}"

if [ -z "$d1" ] || [ -z "$d2" ]; then
  if [ ${#connected[@]} -eq 2 ]; then
    a="${connected[0]}"
    b="${connected[1]}"
    if [ "$(api_of "$a")" -le "$(api_of "$b")" ]; then
      auto_d1="$a"; auto_d2="$b"
    else
      auto_d1="$b"; auto_d2="$a"
    fi
    [ -z "$d1" ] && d1="$auto_d1"
    [ -z "$d2" ] && d2="$auto_d2"
  elif [ ${#connected[@]} -eq 1 ]; then
    # One phone at a time: use it for whichever slot is unset.
    if [ -z "$d1" ] && [ -z "$d2" ]; then
      if [ "$(api_of "${connected[0]}")" -le 10 ]; then
        d1="${connected[0]}"
      else
        d2="${connected[0]}"
      fi
    fi
  fi
fi

if [ "$mode" = "--exports" ]; then
  [ -n "$d1" ] && echo "export LEO_D1='$d1'"
  [ -n "$d2" ] && echo "export LEO_D2='$d2'"
  exit 0
fi

printf 'connected: %s\n\n' "${connected[*]}"

root_state() {
  local serial="$1" su out
  su="$("$adb" -s "$serial" shell 'command -v su' 2>/dev/null | tr -d '\r')"
  if [ -z "$su" ]; then
    printf 'no su'
    return
  fi
  # Never prompt interactively: stdin closed, short timeout.
  out="$(timeout 6 "$adb" -s "$serial" shell 'su -c id </dev/null' 2>/dev/null | tr -d '\r')"
  case "$out" in
    *uid=0*) printf 'su granted (%s)' "$su" ;;
    *) printf 'su present, not granted' ;;
  esac
}

describe() {
  local slot="$1" serial="$2"
  if [ -z "$serial" ]; then
    printf '%-3s %s\n' "$slot" "(unset; export LEO_$slot=<serial>)"
    return
  fi
  if ! is_connected "$serial"; then
    printf '%-3s %-22s NOT CONNECTED\n' "$slot" "$serial"
    return
  fi
  local model android api abi page webview
  model="$(prop "$serial" ro.product.model)"
  android="$(prop "$serial" ro.build.version.release)"
  api="$(prop "$serial" ro.build.version.sdk)"
  abi="$(prop "$serial" ro.product.cpu.abi)"
  page="$("$adb" -s "$serial" shell getconf PAGE_SIZE 2>/dev/null | tr -d '\r')"
  if [ -z "$page" ]; then
    # Android 9 toybox has no getconf: read AT_PAGESZ (type 6) from auxv.
    page_hex="$("$adb" -s "$serial" shell \
      'od -An -tx8 -v /proc/self/auxv | tr -s " " "\n" | awk "p{print; exit} /^0*6\$/{p=1}"' \
      2>/dev/null | tr -d '\r' | tr -d ' ')"
    [ -n "$page_hex" ] && page="$(printf '%d' "0x$page_hex")"
  fi
  webview="$("$adb" -s "$serial" shell dumpsys webviewupdate 2>/dev/null \
    | sed -n 's/.*Current WebView package (name, version): (.*, \(.*\))/\1/p' | head -1 | tr -d '\r')"
  [ -n "$webview" ] || webview="$(prop "$serial" ro.build.version.webview)"
  printf '%-3s %-22s %-22s Android %-5s API %-3s %-9s PAGE_SIZE=%-5s WebView=%-18s root=%s\n' \
    "$slot" "$serial" "$model" "$android" "$api" "${abi:-?}" "${page:-?}" "${webview:-?}" \
    "$(root_state "$serial")"
}

printf '%-3s %-22s %-22s %-13s %-7s %-9s %-14s %-18s %s\n' \
  ID SERIAL MODEL ANDROID API ABI PAGE_SIZE WEBVIEW ROOT
describe D1 "$d1"
describe D2 "$d2"

echo
echo "# ready to paste"
[ -n "$d1" ] && echo "export LEO_D1='$d1'"
[ -n "$d2" ] && echo "export LEO_D2='$d2'"
echo
echo "scripts/smoke.sh \"\$LEO_D2\""
