#!/usr/bin/env bash
# Verify 16 KB page-size safety (plan v9 §4.3, Task 2).
#
#   scripts/check-elf-alignment.sh [--allow-empty] [path ...]
#
# Each path may be an APK (checked with zipalign, every lib/**/*.so inside it,
# and every ELF file under assets/), or a directory/file of ELF shared objects
# (e.g. an extracted runtime package). With no arguments the debug APK is
# checked.
#
# Checks:
#   1. every LOAD segment in every ELF has p_align >= 2**14 (16384);
#   2. every GNU_RELRO ends on a 0x4000 boundary, or has no writable data
#      after it in the same LOAD segment;
#   3. `zipalign -c -P 16 -v 4` accepts the APK (build-tools 35+).
#
# Exit code 0 only when every check passes and at least one ELF was checked.
# `--allow-empty` restores the old "nothing to verify is fine" behaviour.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
allow_empty=0
targets=()

usage() {
  sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
}

while [ $# -gt 0 ]; do
  case "$1" in
    --allow-empty) allow_empty=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; break ;;
    -*) echo "error: unknown option: $1" >&2; usage >&2; exit 2 ;;
    *) targets+=("$1") ;;
  esac
  shift
done
while [ $# -gt 0 ]; do targets+=("$1"); shift; done

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

# --- toolchain discovery -----------------------------------------------------

sdk_dir="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$sdk_dir" ] && [ -f "$root/android/local.properties" ]; then
  sdk_dir="$(sed -n 's/^sdk\.dir=//p' "$root/android/local.properties" | head -1)"
fi
if { [ -z "$sdk_dir" ] || [ ! -d "$sdk_dir" ]; } && [ -d "$HOME/Android/Sdk" ]; then
  sdk_dir="$HOME/Android/Sdk"
fi
if [ -z "$sdk_dir" ] || [ ! -d "$sdk_dir" ]; then
  echo "error: Android SDK not found; set ANDROID_HOME (or android/local.properties sdk.dir)" >&2
  exit 2
fi

# The NDK pin (android/gradle.properties) wins over ambient CI/user variables,
# so a runner-provided ANDROID_NDK_HOME cannot silently change the toolchain.
ndk_pin="$(sed -n 's/^leocode\.ndk=//p' "$root/android/gradle.properties" | head -1)"
ndk_dir=""
if [ -n "$ndk_pin" ] && [ -d "$sdk_dir/ndk/$ndk_pin" ]; then
  ndk_dir="$sdk_dir/ndk/$ndk_pin"
elif [ -n "${ANDROID_NDK_HOME:-}" ] && [ -d "$ANDROID_NDK_HOME" ]; then
  ndk_dir="$ANDROID_NDK_HOME"
elif [ -n "${ANDROID_NDK_ROOT:-}" ] && [ -d "$ANDROID_NDK_ROOT" ]; then
  ndk_dir="$ANDROID_NDK_ROOT"
elif [ -d "$sdk_dir/ndk" ]; then
  ndk_dir="$(find "$sdk_dir/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
fi

readelf=""
if [ -n "$ndk_dir" ]; then
  readelf="$(find "$ndk_dir/toolchains/llvm/prebuilt" -name llvm-readelf 2>/dev/null | head -1)" || true
fi
if [ -z "$readelf" ]; then
  readelf="$(command -v llvm-readelf || true)"
fi
if [ -z "$readelf" ]; then
  echo "error: llvm-readelf not found; install NDK r28 and/or set ANDROID_NDK_HOME" >&2
  exit 2
fi

# zipalign gained -P (page align) in build-tools 35. Probe the capability
# instead of matching help text: a 22-byte empty zip is a valid zip that needs
# no alignment, so exit 0 means -P 16 is genuinely understood.
probe_zip="$tmp_dir/probe.apk"
printf 'PK\005\006\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000' > "$probe_zip"

zipalign=""
if [ -d "$sdk_dir/build-tools" ]; then
  while IFS= read -r candidate; do
    if "$candidate" -c -P 16 -v 4 "$probe_zip" >/dev/null 2>&1; then
      zipalign="$candidate"
      break
    fi
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

fail=0
checked=0

# hex2dec as awk functions (awk numbers are doubles; Android addresses are small
# enough for exact integer arithmetic here).
read -r -d '' awk_hex <<'AWK' || true
function hex2dec(h,   i, d, n) {
  h = tolower(h); sub(/^0x/, "", h); n = 0
  for (i = 1; i <= length(h); i++) {
    d = index("0123456789abcdef", substr(h, i, 1)) - 1
    n = n * 16 + d
  }
  return n
}
AWK

# Label argument is printed verbatim; $1 is the ELF path.
check_elf() {
  local so="$1" label="$2" out load_count align bad relro_bad

  if [ ! -f "$so" ]; then
    echo "FAIL $label: file not found"
    fail=1
    return 0
  fi

  # Capture readelf output and status. Never pipe it straight into awk: a
  # corrupt/misnamed file must fail, not report "p_align none".
  if ! out="$("$readelf" -Wl "$so" 2>"$tmp_dir/readelf.err")"; then
    echo "FAIL $label: not a readable ELF (readelf exited non-zero)"
    sed 's/^/     /' "$tmp_dir/readelf.err" | head -5
    fail=1
    return 0
  fi

  load_count="$(printf '%s\n' "$out" | awk '$1 == "LOAD" { n++ } END { print n + 0 }')"
  if [ "$load_count" -eq 0 ]; then
    echo "FAIL $label: no LOAD program header (not an ELF?)"
    fail=1
    return 0
  fi

  checked=$((checked + 1))

  # 1. LOAD p_align must be >= 0x4000.
  bad="$(printf '%s\n' "$out" | awk "$awk_hex"'
    $1 == "LOAD" {
      align = $NF
      if (align ~ /^0x/) align = hex2dec(align)
      if (align + 0 < 16384) print $NF
    }' | sort -u | tr '\n' ' ')"
  if [ -n "$bad" ]; then
    echo "FAIL $label: LOAD p_align ${bad}(expected >= 0x4000)"
    fail=1
    return 0
  fi

  # 2. RELRO must end on a 0x4000 boundary, unless the containing writable
  #    LOAD segment ends there too (nothing writable after it is affected by
  #    the loader's page-rounded mprotect).
  #
  #    This is a heuristic: it uses program headers only. A LOAD with no W
  #    flag, or a following writable LOAD in another segment, is accepted.
  relro_bad="$(printf '%s\n' "$out" | awk "$awk_hex"'
    $1 == "LOAD" {
      n++; lv[n] = hex2dec($3); lm[n] = hex2dec($6)
      lw[n] = 0
      # Flags occupy the tokens between MemSiz and Align: "R E", "RW", "R", ...
      for (i = 7; i < NF; i++) if (index($i, "W") > 0) lw[n] = 1
    }
    $1 == "GNU_RELRO" { r++; rv[r] = hex2dec($3); rm[r] = hex2dec($6) }
    END {
      for (j = 1; j <= r; j++) {
        end = rv[j] + rm[j]
        if (end % 16384 == 0) continue
        bad = 0
        for (i = 1; i <= n; i++) {
          if (!lw[i]) continue
          if (rv[j] >= lv[i] && rv[j] < lv[i] + lm[i] && end < lv[i] + lm[i]) bad = 1
        }
        if (bad)
          printf "GNU_RELRO ends at 0x%x (not 0x4000-aligned) with writable data after it\n", end
      }
    }')"
  if [ -n "$relro_bad" ]; then
    echo "FAIL $label: ${relro_bad}"
    fail=1
    return 0
  fi

  align="$(printf '%s\n' "$out" | awk '$1 == "LOAD" { print $NF }' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
  echo "ok   $label (LOAD p_align ${align})"
  return 0
}

is_elf() {
  local magic
  magic="$(head -c 4 "$1" 2>/dev/null | od -An -tx1 | tr -d ' \n')" || true
  [ "$magic" = "7f454c46" ]
}

check_apk() {
  local apk="$1" work found_lib found_assets so f
  echo "== APK $apk"
  if [ ! -f "$apk" ]; then
    echo "FAIL missing APK: $apk"
    fail=1
    return 0
  fi
  if ! "$zipalign" -c -P 16 -v 4 "$apk" >/dev/null 2>"$tmp_dir/zipalign.err"; then
    echo "FAIL zipalign -c -P 16 rejected $apk"
    sed 's/^/     /' "$tmp_dir/zipalign.err" | head -20
    fail=1
  else
    echo "ok   zipalign -c -P 16 -v 4"
  fi

  work="$tmp_dir/apk-$(basename "$apk")"
  rm -rf "$work"
  mkdir -p "$work"
  # Native libraries may be compressed (legacy packaging); extract before
  # reading ELF headers. assets/ can carry ELF executables (python launcher).
  if ! unzip -q -o "$apk" 'lib/*' -d "$work" 2>/dev/null; then
    :
  fi
  if ! unzip -q -o "$apk" 'assets/*' -d "$work" 2>/dev/null; then
    :
  fi

  found_lib=0
  if [ -d "$work/lib" ]; then
    while IFS= read -r so; do
      [ -z "$so" ] && continue
      found_lib=$((found_lib + 1))
      check_elf "$so" "${apk##*/}:${so#"$work"/}"
    done < <(find "$work/lib" -name '*.so' -type f | sort)
  fi
  if [ "$found_lib" -eq 0 ]; then
    echo "note no .so files under lib/ in $apk"
  fi

  found_assets=0
  if [ -d "$work/assets" ]; then
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      if is_elf "$f"; then
        found_assets=$((found_assets + 1))
        check_elf "$f" "${apk##*/}:${f#"$work"/}"
      fi
    done < <(find "$work/assets" -type f | sort)
  fi
  if [ "$found_assets" -gt 0 ]; then
    echo "note checked $found_assets ELF file(s) under assets/"
  fi
  return 0
}

collect_elfs() {
  local path="$1"
  if [ -d "$path" ]; then
    find "$path" -name '*.so' -type f | sort
  else
    printf '%s\n' "$path"
  fi
}

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
  if [ "$allow_empty" -eq 1 ]; then
    echo "16 KB check: no ELF files checked (--allow-empty)"
    exit 0
  fi
  echo "FAIL 16 KB check: no ELF files checked (pass --allow-empty to allow this)"
  exit 1
fi
echo "16 KB check: PASSED ($checked ELF file(s))"
