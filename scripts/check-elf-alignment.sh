#!/usr/bin/env bash
# Verify 16 KB page-size safety (plan v9 §4.3, Task 2).
#
#   scripts/check-elf-alignment.sh [path ...]
#
# Each path may be an APK (checked with zipalign and every lib/**/*.so inside it),
# or a directory/file of ELF shared objects (e.g. an extracted runtime package).
# With no arguments the debug APK is checked.
#
# Checks:
#   1. every LOAD segment in every .so has p_align >= 2**14 (16384);
#   2. `zipalign -c -P 16 -v 4` accepts the APK (build-tools 35+).
#
# Exit code 0 only when every check passes.
set -uo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# --- toolchain discovery -----------------------------------------------------

sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$sdk_dir" ] && [ -f "$root/android/local.properties" ]; then
  sdk_dir="$(sed -n 's/^sdk\.dir=//p' "$root/android/local.properties" | head -1)"
fi
if [ -z "$sdk_dir" ] || [ ! -d "$sdk_dir" ]; then
  echo "error: Android SDK not found; set ANDROID_HOME (or android/local.properties sdk.dir)" >&2
  exit 2
fi

ndk_pin="$(sed -n 's/^leocode\.ndk=//p' "$root/android/gradle.properties" | head -1)"
ndk_dir="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [ -z "$ndk_dir" ] && [ -n "$ndk_pin" ] && [ -d "$sdk_dir/ndk/$ndk_pin" ]; then
  ndk_dir="$sdk_dir/ndk/$ndk_pin"
fi
if [ -z "$ndk_dir" ] && [ -d "$sdk_dir/ndk" ]; then
  ndk_dir="$(find "$sdk_dir/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
fi

readelf=""
if [ -n "$ndk_dir" ]; then
  readelf="$(find "$ndk_dir/toolchains/llvm/prebuilt" -name llvm-readelf 2>/dev/null | head -1)"
fi
if [ -z "$readelf" ]; then
  readelf="$(command -v llvm-readelf || true)"
fi
if [ -z "$readelf" ]; then
  echo "error: llvm-readelf not found; install NDK r28 and/or set ANDROID_NDK_HOME" >&2
  exit 2
fi

# zipalign gained -P (page align) in build-tools 35. Pick the newest that has it.
zipalign=""
if [ -d "$sdk_dir/build-tools" ]; then
  while IFS= read -r candidate; do
    help_text="$("$candidate" 2>&1 || true)"
    case "$help_text" in
      *"-P <pagesize_kb>"*) zipalign="$candidate"; break ;;
    esac
  done < <(find "$sdk_dir/build-tools" -mindepth 2 -maxdepth 2 -name zipalign -type f | sort -Vr)
fi
if [ -z "$zipalign" ]; then
  echo "error: zipalign with -P not found; install build-tools 35.0.0 or newer" >&2
  exit 2
fi

echo "readelf:  $readelf"
echo "zipalign: $zipalign"
echo

# --- checks ------------------------------------------------------------------

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT
fail=0
checked=0

check_elf() {
  local so="$1" label="$2" bad
  checked=$((checked + 1))
  # LOAD lines: Type Offset VirtAddr PhysAddr FileSiz MemSiz Flg Align
  bad="$("$readelf" -Wl "$so" 2>/dev/null | awk '
    function hex2dec(h,   i, d, n) {
      h = tolower(h); sub(/^0x/, "", h); n = 0
      for (i = 1; i <= length(h); i++) {
        d = index("0123456789abcdef", substr(h, i, 1)) - 1
        n = n * 16 + d
      }
      return n
    }
    $1 == "LOAD" {
      align = $NF
      if (align ~ /^0x/) align = hex2dec(align)
      if (align + 0 < 16384) print $NF
    }' | sort -u | tr '\n' ' ')"
  if [ -n "$bad" ]; then
    echo "FAIL $label: LOAD p_align ${bad}(expected >= 0x4000)"
    fail=1
  else
    local align
    align="$("$readelf" -Wl "$so" 2>/dev/null | awk '$1 == "LOAD" { print $NF }' | sort -u | tr '\n' ' ')"
    echo "ok   $label (LOAD p_align ${align:-none})"
  fi
}

check_apk() {
  local apk="$1"
  echo "== APK $apk"
  if [ ! -f "$apk" ]; then
    echo "FAIL missing APK: $apk"
    fail=1
    return
  fi
  if ! "$zipalign" -c -P 16 -v 4 "$apk" >/dev/null 2>"$tmp_dir/zipalign.err"; then
    echo "FAIL zipalign -c -P 16 rejected $apk"
    sed 's/^/     /' "$tmp_dir/zipalign.err" | head -20
    fail=1
  else
    echo "ok   zipalign -c -P 16 -v 4"
  fi

  local work="$tmp_dir/apk"
  rm -rf "$work"
  mkdir -p "$work"
  # Native libraries may be compressed (legacy packaging); extract before reading ELF headers.
  if ! unzip -q -o "$apk" 'lib/*' -d "$work" 2>/dev/null; then
    echo "note no lib/ entries in $apk"
  fi
  local found=0
  while IFS= read -r so; do
    found=$((found + 1))
    check_elf "$so" "${apk##*/}:${so#"$work"/}"
  done < <(find "$work" -name '*.so' -type f | sort)
  [ "$found" -eq 0 ] && echo "note no .so files inside $apk"
}

collect_elfs() {
  local path="$1"
  if [ -d "$path" ]; then
    find "$path" -name '*.so' -type f | sort
  else
    printf '%s\n' "$path"
  fi
}

targets=("$@")
if [ ${#targets[@]} -eq 0 ]; then
  targets=("$root/android/app/build/outputs/apk/debug/app-debug.apk")
fi

for target in "${targets[@]}"; do
  case "$target" in
    *.apk) check_apk "$target" ;;
    *)
      while IFS= read -r so; do
        [ -n "$so" ] && check_elf "$so" "$so"
      done < <(collect_elfs "$target")
      ;;
  esac
done

echo
if [ "$fail" -ne 0 ]; then
  echo "16 KB check: FAILED"
  exit 1
fi
if [ "$checked" -eq 0 ]; then
  echo "16 KB check: no .so files checked (nothing to verify)"
  exit 0
fi
echo "16 KB check: PASSED ($checked shared object(s))"
