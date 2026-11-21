#!/usr/bin/env bash
# Tests for scripts/check-elf-alignment.sh (Phase A finding A-03).
#
#   scripts/tests/run-elf-alignment-tests.sh
#
# Builds throwaway APK-shaped fixtures in a temp directory with the pinned NDK
# clang and checks the exit code of the alignment checker for each case:
#   - APK with no .so                          -> exit 1
#   - APK with a 4 KB-aligned .so              -> exit 1
#   - APK with a text file renamed to .so      -> exit 1
#   - APK with an ELF that has no LOAD segment -> exit 1
#   - APK with a 4 KB-aligned ELF under assets -> exit 1
#   - the real debug APK                       -> exit 0
#   - empty APK without --allow-empty          -> exit 1
#   - empty APK with --allow-empty             -> exit 0
#
# Exit code 0 only when every case passes. Fixtures are never committed.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
checker="$root/scripts/check-elf-alignment.sh"
real_apk="$root/android/app/build/outputs/apk/debug/app-debug.apk"

sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
if [ -z "$sdk" ] && [ -f "$root/android/local.properties" ]; then
  sdk="$(sed -n 's/^sdk\.dir=//p' "$root/android/local.properties" | head -1)"
fi
if { [ -z "$sdk" ] || [ ! -d "$sdk" ]; } && [ -d "$HOME/Android/Sdk" ]; then
  sdk="$HOME/Android/Sdk"
fi
ndk_pin="$(sed -n 's/^leocode\.ndk=//p' "$root/android/gradle.properties" | head -1)"
ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [ -n "$sdk" ] && [ -n "$ndk_pin" ] && [ -d "$sdk/ndk/$ndk_pin" ]; then
  ndk="$sdk/ndk/$ndk_pin"
fi

clang=""
if [ -n "$ndk" ]; then
  clang="$(find "$ndk/toolchains/llvm/prebuilt" -name aarch64-linux-android28-clang 2>/dev/null | head -1)" || true
fi
zipalign=""
if [ -n "$sdk" ] && [ -d "$sdk/build-tools" ]; then
  zipalign="$(find "$sdk/build-tools" -mindepth 2 -maxdepth 2 -name zipalign -type f | sort -V | tail -1)"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

total=0
fail=0

pass_case() {
  total=$((total + 1))
  echo "PASS $1"
}

fail_case() {
  total=$((total + 1))
  fail=$((fail + 1))
  echo "FAIL $1${2:+: $2}"
}

make_apk() {
  # make_apk <out.apk> <source-dir>
  # zip can store tiny entries and break 4-byte alignment; realign the fixture
  # so a FAIL can only come from the ELF check, not from zipalign.
  (cd "$2" && zip -q -r -X "$1" .)
  if [ -n "$zipalign" ]; then
    "$zipalign" -f 4 "$1" "$1.aligned"
    mv "$1.aligned" "$1"
  fi
}

run_case() {
  # run_case <name> <expected-exit> <expected-substring-or-empty> [args...]
  local name="$1" want="$2" want_out="$3"
  shift 3
  local out rc=0
  out="$(bash "$checker" "$@" 2>&1)" || rc=$?
  if [ "$rc" -ne "$want" ]; then
    fail_case "$name" "exit $rc, wanted $want"
    printf '%s\n' "$out" | sed 's/^/     /'
    return 0
  fi
  if [ -n "$want_out" ] && ! printf '%s\n' "$out" | grep -qF -- "$want_out"; then
    fail_case "$name" "output missing: $want_out"
    printf '%s\n' "$out" | sed 's/^/     /'
    return 0
  fi
  pass_case "$name"
  return 0
}

# --- preconditions -----------------------------------------------------------

if [ ! -f "$checker" ]; then
  echo "FAIL precondition: $checker not found"
  exit 1
fi
if ! command -v zip >/dev/null 2>&1; then
  echo "FAIL precondition: 'zip' not found"
  exit 1
fi
if [ -z "$clang" ] || [ ! -x "$clang" ]; then
  echo "FAIL precondition: aarch64-linux-android28-clang not found in the pinned NDK (${ndk_pin:-unset})"
  exit 1
fi

# --- fixture: APK with no .so ------------------------------------------------

mkdir -p "$tmp/no-so/assets/web"
echo "no native code" > "$tmp/no-so/assets/web/index.html"
make_apk "$tmp/no-so.apk" "$tmp/no-so"

run_case "no .so in APK -> exit 1" 1 "no ELF files checked" "$tmp/no-so.apk"

# --- fixture: 4 KB-aligned .so ----------------------------------------------

mkdir -p "$tmp/align4k/lib/arm64-v8a"
printf 'int leocode_fixture(void) { return 42; }\n' > "$tmp/align4k/lib.c"
if ! "$clang" -shared -fPIC -Wl,-z,max-page-size=4096 \
    -o "$tmp/align4k/lib/arm64-v8a/libleocodefixture.so" "$tmp/align4k/lib.c"; then
  echo "FAIL precondition: could not compile the 4 KB-aligned fixture"
  exit 1
fi
rm -f "$tmp/align4k/lib.c"
make_apk "$tmp/align4k.apk" "$tmp/align4k"

run_case "4 KB-aligned .so -> exit 1" 1 "LOAD p_align 0x1000" "$tmp/align4k.apk"

# --- fixture: text file renamed to .so --------------------------------------

mkdir -p "$tmp/fake-elf/lib/arm64-v8a"
echo "this is definitely not an ELF file" > "$tmp/fake-elf/lib/arm64-v8a/libleocodefake.so"
make_apk "$tmp/fake-elf.apk" "$tmp/fake-elf"

run_case "text renamed to .so -> exit 1" 1 "not a readable ELF" "$tmp/fake-elf.apk"

# --- fixture: relocatable object (ELF, but no LOAD) renamed to .so ----------

mkdir -p "$tmp/no-load/lib/arm64-v8a"
printf 'int leocode_fixture(void) { return 7; }\n' > "$tmp/no-load/obj.c"
if ! "$clang" -c -fPIC -o "$tmp/no-load/lib/arm64-v8a/libleocodenoload.so" "$tmp/no-load/obj.c"; then
  echo "FAIL precondition: could not compile the no-LOAD fixture"
  exit 1
fi
rm -f "$tmp/no-load/obj.c"
make_apk "$tmp/no-load.apk" "$tmp/no-load"

run_case "ELF with no LOAD segment -> exit 1" 1 "no LOAD program header" "$tmp/no-load.apk"

# --- fixture: 4 KB-aligned ELF under assets/ --------------------------------

mkdir -p "$tmp/assets-elf/assets/runtime"
printf 'int main(void) { return 0; }\n' > "$tmp/assets-elf/launcher.c"
if ! "$clang" -fPIE -pie -Wl,-z,max-page-size=4096 \
    -o "$tmp/assets-elf/assets/runtime/python3-launcher" "$tmp/assets-elf/launcher.c"; then
  echo "FAIL precondition: could not compile the assets ELF fixture"
  exit 1
fi
rm -f "$tmp/assets-elf/launcher.c"
make_apk "$tmp/assets-elf.apk" "$tmp/assets-elf"

run_case "4 KB-aligned ELF under assets/ -> exit 1" 1 "LOAD p_align 0x1000" "$tmp/assets-elf.apk"

# --- real debug APK ----------------------------------------------------------

if [ ! -f "$real_apk" ]; then
  fail_case "real debug APK -> exit 0" "missing $real_apk (run assembleDebug first)"
else
  run_case "real debug APK -> exit 0" 0 "assets/runtime/python3-launcher" "$real_apk"
fi

# --- --allow-empty override --------------------------------------------------

printf 'PK\005\006\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000' > "$tmp/empty.apk"
run_case "empty APK -> exit 1" 1 "no ELF files checked" "$tmp/empty.apk"
run_case "--allow-empty on empty APK -> exit 0" 0 "no ELF files checked (--allow-empty)" \
  --allow-empty "$tmp/empty.apk"

# --- summary -----------------------------------------------------------------

echo
if [ "$fail" -ne 0 ]; then
  echo "elf-alignment tests: FAILED ($fail/$total)"
  exit 1
fi
echo "elf-alignment tests: PASSED ($total/$total)"
