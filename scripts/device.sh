#!/usr/bin/env bash
# Reusable device-testing commands for LeoCode (Tasks 10+ demos).
#
# The WebView is a canvas: uiautomator sees one node, so UI driving uses the
# bottom-tab fractions below. Everything else is plain adb, wrapped so a demo is
# one command instead of a dozen.
#
#   scripts/device.sh list
#   scripts/device.sh --device d2 install
#   scripts/device.sh --device d2 start
#   scripts/device.sh --device d2 tab terminal
#   scripts/device.sh --device d2 type 'sleep 600; echo done' --enter
#   scripts/device.sh --device d2 home
#   scripts/device.sh --device d2 wait 600
#   scripts/device.sh --device d2 start
#   scripts/device.sh --device d2 shot after-reattach
#   scripts/device.sh --device d2 report task10
#
# Device slots: --device d1|d2|<serial> (default: the only connected device).
# LEO_D1 / LEO_D2 from `scripts/devices.sh --exports` are honoured.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
adb="${ADB:-adb}"
app_id="dev.leocode"
activity="$app_id/.MainActivity"
apk_default="$root/android/app/build/outputs/apk/debug/app-debug.apk"
out_dir="${LEO_SHOT_DIR:-$root/docs/device-reports}"

# Bottom-tab centres as fractions of the display (WebView has no a11y tree).
tab_x_explorer="${LEO_TAB_X_EXPLORER:-0.125}"
tab_x_editor="${LEO_TAB_X_EDITOR:-0.375}"
tab_x_terminal="${LEO_TAB_X_TERMINAL:-0.625}"
tab_x_runtimes="${LEO_TAB_X_RUNTIMES:-0.875}"
# Distance from the bottom edge to the tab-row centre. 3-button navigation has a
# ~132 px system bar; gesture navigation only a small handle. Override with
# LEO_TAB_Y_OFFSET (px) or LEO_TAB_Y (fraction of the display height).
tab_y_offset="${LEO_TAB_Y_OFFSET:-}"
tab_y_fraction="${LEO_TAB_Y:-}"

usage() {
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'

Commands:
  list                          connected devices and slots
  install [apk]                 install -r (default: debug APK)
  start [--cold]                wake + launch (--cold force-stops first)
  stop                          force-stop the app
  clear                         pm clear (wipes app data)
  wake                          wake screen and dismiss the keyguard
  home | back                   key events
  tap <x> <y>                   tap absolute pixels
  tap-pct <x> <y>               tap percentages of the display (0-1 or 0-100)
  tab <explorer|editor|terminal|runtimes>
  drawer close                  tap outside the explorer drawer
  type <text...> [--enter] [--slow[=ms]]
                                type text; --slow chunks for older phones
  key <enter|back|home|tab|esc|ctrl-c|KEYCODE_X>
  shot [label]                  screenshot to $LEO_SHOT_DIR (default docs/device-reports)
  ui [pattern]                  dump the hierarchy; grep text/desc/bounds
  ps [pattern]                  processes matching the app or pattern
  service                       foreground-service state
  notif [pattern]               notification dump (noredact)
  logs [lines] [tag]            logcat tail (default 200 lines, app tags)
  size                          physical display size
  fg                            focused window
  wait <seconds>                sleep (for timed demo steps)
  wait-for-service [seconds]    poll until SessionService is foreground
  demo bg-reattach <seconds> [command]
                                full Task 10 flow: type, background, wait, return
  report [label]                text snapshot into docs/device-reports
EOF
}

die() { echo "error: $*" >&2; exit 2; }

connected_first() {
  "$adb" devices | awk 'NR > 1 && $2 == "device" { print $1; exit }'
}

resolve_slot() {
  case "${1:-}" in
    d1|D1) printf '%s' "${LEO_D1:-}" ;;
    d2|D2) printf '%s' "${LEO_D2:-}" ;;
    *) printf '%s' "${1:-}" ;;
  esac
}

slot=""
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --device|-d)
      [ $# -ge 2 ] || die "--device needs a value"
      slot="$2"; shift 2 ;;
    --help|-h)
      usage; exit 0 ;;
    *)
      args+=("$1"); shift ;;
  esac
done

command="${args[0]:-}"
[ -n "$command" ] || { usage; exit 2; }
set -- "${args[@]:1}"

serial="$(resolve_slot "$slot")"
if [ -z "$serial" ]; then
  serial="$(connected_first)"
  [ -n "$serial" ] || die "no connected device (adb devices -l)"
fi

if [ "$command" != "list" ] && ! "$adb" -s "$serial" get-state >/dev/null 2>&1; then
  die "device '$serial' is not connected"
fi

adb_s() { "$adb" -s "$serial" "$@"; }
sh_s() { adb_s shell "$@"; }

model=""
api=""
describe_target() {
  [ -n "$model" ] && return 0
  model="$(sh_s getprop ro.product.model 2>/dev/null | tr -d '\r' || true)"
  api="$(sh_s getprop ro.build.version.sdk 2>/dev/null | tr -d '\r' || true)"
}
banner() {
  describe_target
  printf '== %s (API %s) · %s\n' "${model:-?}" "${api:-?}" "$serial"
}

display_size() {
  # `wm size` prints "Physical size: 1080x2246" plus an optional override line.
  sh_s wm size | tr -d '\r' | awk -F': ' '/Physical size/ { print $2; exit }'
}

require_dimensions() {
  local size w h
  size="$(display_size)"
  [ -n "$size" ] || die "could not read the display size"
  w="${size%x*}"
  h="${size#*x}"
  printf '%s %s' "$w" "$h"
}

tap_xy() {
  adb_s shell input tap "$1" "$2"
}

cmd_list() {
  "$adb" devices -l
  echo
  "$root/scripts/devices.sh" 2>/dev/null || true
}

cmd_install() {
  local apk="${1:-$apk_default}"
  [ -f "$apk" ] || die "APK not found: $apk"
  banner
  adb_s install -r "$apk"
}

cmd_start() {
  local cold=0
  [ "${1:-}" = "--cold" ] && cold=1
  adb_s shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_s shell wm dismiss-keyguard >/dev/null 2>&1 || true
  [ "$cold" = 1 ] && adb_s shell am force-stop "$app_id" >/dev/null 2>&1 || true
  adb_s shell am start -n "$activity" 2>&1 | tail -1
}

cmd_wake() {
  adb_s shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  adb_s shell wm dismiss-keyguard >/dev/null 2>&1 || true
}

tab_row_y() {
  local h="$1"
  if [ -n "$tab_y_offset" ]; then
    printf '%d' "$((h - tab_y_offset))"
    return
  fi
  if [ -n "$tab_y_fraction" ]; then
    awk -v h="$h" -v f="$tab_y_fraction" 'BEGIN { printf "%d", h * f }'
    return
  fi
  describe_target
  local mode
  mode="$(sh_s settings get secure navigation_mode 2>/dev/null | tr -d '\r' || true)"
  if [ "${api:-0}" -ge 29 ] && [ "$mode" = "2" ]; then
    printf '%d' "$((h - 76))"
  else
    printf '%d' "$((h - 210))"
  fi
}

cmd_tab() {
  local which="${1:-}"
  local fraction
  case "$which" in
    explorer|files) fraction="$tab_x_explorer" ;;
    editor) fraction="$tab_x_editor" ;;
    terminal|term) fraction="$tab_x_terminal" ;;
    runtimes|runtime) fraction="$tab_x_runtimes" ;;
    *) die "usage: tab <explorer|editor|terminal|runtimes>" ;;
  esac
  local size w h x y
  size="$(require_dimensions)"
  w="${size% *}"; h="${size#* }"
  x="$(awk -v w="$w" -v f="$fraction" 'BEGIN { printf "%d", w * f }')"
  y="$(tab_row_y "$h")"
  cmd_wake
  tap_xy "$x" "$y"
}

cmd_drawer() {
  case "${1:-}" in
    close)
      local size w h
      size="$(require_dimensions)"
      w="${size% *}"; h="${size#* }"
      cmd_wake
      # Tap the backdrop, outside the drawer panel.
      tap_xy "$((w * 95 / 100))" "$((h / 2))"
      ;;
    *) die "usage: drawer close" ;;
  esac
}

input_text() {
  # Quote for the device shell so ';', '&', '|' are not eaten by /system/bin/sh.
  local escaped
  escaped="$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
  adb_s shell "input text '$escaped'"
}

cmd_type() {
  local text=""
  local enter=0
  local delay=0
  local parts=()
  while [ $# -gt 0 ]; do
    case "$1" in
      --enter) enter=1; shift ;;
      --slow) delay=120; shift ;;
      --slow=*) delay="${1#--slow=}"; shift ;;
      --delay) delay="$2"; shift 2 ;;
      *) parts+=("$1"); shift ;;
    esac
  done
  text="${parts[*]:-}"
  [ -n "$text" ] || die "usage: type <text...> [--enter] [--slow[=ms]]"

  if [ "$delay" -gt 0 ] 2>/dev/null; then
    # Old WebViews/IMEs duplicate a long burst of key events. Send a few
    # characters at a time and let the shell echo before the next chunk.
    local i=0 length=${#text}
    while [ "$i" -lt "$length" ]; do
      input_text "${text:$i:2}"
      i=$((i + 2))
      sleep "0.$(printf '%03d' "$delay")"
    done
  else
    input_text "$text"
  fi
  [ "$enter" = 1 ] && adb_s shell input keyevent 66
  return 0
}

cmd_key() {
  local key="${1:-}"
  case "$key" in
    enter) adb_s shell input keyevent 66 ;;
    back) adb_s shell input keyevent 4 ;;
    home) adb_s shell input keyevent 3 ;;
    tab) adb_s shell input keyevent 61 ;;
    esc) adb_s shell input keyevent 111 ;;
    ctrl-c|ctrl+c) adb_s shell input keycombination 113 31 ;;
    KEYCODE_*) adb_s shell input keyevent "$key" ;;
    *) die "usage: key <enter|back|home|tab|esc|ctrl-c|KEYCODE_X>" ;;
  esac
}

cmd_shot() {
  local label="${1:-shot}"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$out_dir"
  local file="$out_dir/${stamp}-${label}-${serial//[:\/]/_}.png"
  adb_s exec-out screencap -p >"$file"
  echo "$file"
}

cmd_ui() {
  local pattern="${1:-}"
  adb_s shell uiautomator dump /sdcard/leocode-ui.xml >/dev/null 2>&1
  adb_s shell cat /sdcard/leocode-ui.xml | python3 -c '
import re, sys
pattern = sys.argv[1] if len(sys.argv) > 1 else ""
xml = sys.stdin.read()
for m in re.finditer(r"<node[^>]*>", xml):
    node = m.group(0)
    def attr(name):
        hit = re.search(name + r"=\"([^\"]*)\"", node)
        return hit.group(1) if hit else ""
    label = attr("text") or attr("content-desc")
    if not label and attr("clickable") != "true":
        continue
    if pattern and pattern not in label:
        continue
    print(f"{label!r}  {attr(\"bounds\")}  class={attr(\"class\")}")
' "$pattern"
}

cmd_ps() {
  local pattern="${1:-}"
  if [ -n "$pattern" ]; then
    sh_s ps -A 2>/dev/null | grep -E "$pattern" || true
  else
    local pid
    pid="$(sh_s pidof "$app_id" 2>/dev/null | tr -d '\r' || true)"
    [ -n "$pid" ] && sh_s ps -A 2>/dev/null | awk -v pid="$pid" '$2 == pid || $3 == pid || $4 == pid'
    sh_s ps -A 2>/dev/null | grep -E " (sh|sleep)$" || true
  fi
}

cmd_service() {
  adb_s shell dumpsys activity services "$app_id" 2>/dev/null \
    | grep -E "ServiceRecord|isForeground|foregroundId|stopWithTask" || true
}

cmd_notif() {
  adb_s shell dumpsys notification --noredact 2>/dev/null \
    | grep -A5 -E "${1:-processes running}" || true
}

cmd_logs() {
  local lines="${1:-200}"
  local tags="${2:-LeoCode:V LeoCodeWeb:V LeoCodeHarness:I AndroidRuntime:E libc:E *:S}"
  # shellcheck disable=SC2086
  adb_s logcat -d -v time -t "$lines" -s $tags 2>/dev/null || true
}

cmd_size() { adb_s shell wm size; adb_s shell wm density; }

cmd_fg() {
  adb_s shell dumpsys activity activities 2>/dev/null \
    | grep -E "topResumedActivity|mResumedActivity" | head -2 || true
}

cmd_wait() {
  local seconds="${1:-}"
  [ -n "$seconds" ] || die "usage: wait <seconds>"
  sleep "$seconds"
}

cmd_wait_for_service() {
  local timeout="${1:-15}"
  local deadline=$(( $(date +%s) + timeout ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if adb_s shell dumpsys activity services "$app_id" 2>/dev/null | grep -q "isForeground=true"; then
      echo "SessionService is foreground"
      return 0
    fi
    sleep 0.5
  done
  echo "error: SessionService was not foreground within ${timeout}s" >&2
  return 1
}

cmd_report() {
  local label="${1:-report}"
  local stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$out_dir"
  local file="$out_dir/${stamp}-devicectl-${label}-${serial//[:\/]/_}.txt"
  describe_target
  {
    echo "# LeoCode device report: $label"
    echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "serial:    $serial"
    echo "model:     ${model:-?}"
    echo "api:       ${api:-?}"
    echo "apk:       $(adb_s shell dumpsys package "$app_id" 2>/dev/null | grep -m1 versionName | tr -d '\r')"
    echo
    echo "## focus"
    cmd_fg
    echo
    echo "## foreground service"
    cmd_service
    echo
    echo "## notification"
    cmd_notif
    echo
    echo "## app processes"
    cmd_ps
    echo
    echo "## logcat (100)"
    cmd_logs 100
  } >"$file"
  echo "$file"
}

cmd_demo_bg_reattach() {
  local seconds="${1:-}"
  shift || true
  local text="${*:-sleep 600; echo done}"
  [ -n "$seconds" ] || die "usage: demo bg-reattach <seconds> [command]"

  banner
  cmd_start
  sleep 3
  cmd_tab terminal
  sleep 2
  cmd_type "$text" --enter
  sleep 1
  echo "== running children"
  cmd_ps
  echo "== foreground service"
  cmd_service
  echo "== background for ${seconds}s"
  cmd_key home
  sleep "$seconds"
  echo "== returning"
  cmd_start
  sleep 3
  cmd_shot "task10-reattach"
  cmd_service
  cmd_report "task10-reattach"
}

case "$command" in
  list) cmd_list ;;
  install) cmd_install "$@" ;;
  start) cmd_start "$@" ;;
  stop) adb_s shell am force-stop "$app_id" ;;
  clear) adb_s shell pm clear "$app_id" ;;
  wake) cmd_wake ;;
  home) cmd_key home ;;
  back) cmd_key back ;;
  tap) [ $# -ge 2 ] || die "usage: tap <x> <y>"; cmd_wake; tap_xy "$1" "$2" ;;
  tap-pct)
    [ $# -ge 2 ] || die "usage: tap-pct <x> <y>"
    size="$(require_dimensions)"; w="${size% *}"; h="${size#* }"
    x="$(awk -v w="$w" -v p="$1" 'BEGIN { if (p <= 1) p *= 100; printf "%d", w * p / 100 }')"
    y="$(awk -v h="$h" -v p="$2" 'BEGIN { if (p <= 1) p *= 100; printf "%d", h * p / 100 }')"
    cmd_wake; tap_xy "$x" "$y" ;;
  tab) cmd_tab "$@" ;;
  drawer) cmd_drawer "$@" ;;
  type) cmd_type "$@" ;;
  key) cmd_key "$@" ;;
  shot) cmd_shot "$@" ;;
  ui) cmd_ui "$@" ;;
  ps) cmd_ps "$@" ;;
  service) cmd_service ;;
  notif) cmd_notif "$@" ;;
  logs) cmd_logs "$@" ;;
  size) cmd_size ;;
  fg) cmd_fg ;;
  wait) cmd_wait "$@" ;;
  wait-for-service) cmd_wait_for_service "$@" ;;
  demo)
    sub="${1:-}"; shift || true
    case "$sub" in
      bg-reattach) cmd_demo_bg_reattach "$@" ;;
      *) die "usage: demo bg-reattach <seconds> [command]" ;;
    esac ;;
  report) cmd_report "$@" ;;
  help|-h|--help) usage ;;
  *) die "unknown command: $command (try --help)" ;;
esac
