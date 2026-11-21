#!/usr/bin/env bash
# Rebuild the bundled Python launcher and verify it matches the committed asset.
#
# The official python.org Android package ships libpython and the standard
# library but no executable (PEP 738). LeoCode installs a small launcher to
# <prefix>/bin/python3; it derives PYTHONHOME from /proc/self/exe and dlopen()s
# <prefix>/lib/libpython3.<minor>.so, so no Python headers are needed here.
#
# Usage:
#   scripts/build-python-launcher.sh            rebuild the committed asset
#   scripts/build-python-launcher.sh --check    fail if the asset is stale
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
src="$root/android/app/src/main/cpp/python_launcher.c"
out="$root/android/app/src/main/assets/runtime/python3-launcher"

ndk="${ANDROID_NDK_HOME:-${ANDROID_NDK_ROOT:-}}"
if [ -z "$ndk" ]; then
  sdk="${ANDROID_HOME:-$HOME/Android/Sdk}"
  ndk="$(find "$sdk/ndk" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$ndk" ] || [ ! -d "$ndk" ]; then
  echo "error: Android NDK not found; set ANDROID_NDK_HOME" >&2
  exit 1
fi

cc="$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android28-clang"
if [ ! -x "$cc" ]; then
  echo "error: $cc not found (NDK $ndk)" >&2
  exit 1
fi

check=0
if [ "${1:-}" = "--check" ]; then
  check=1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
built="$tmp/python3-launcher"

# No libpython at build time: the symbol is resolved with dlsym at runtime.
"$cc" -O2 -fPIE -pie -Wall -Wextra \
  -Wl,-z,max-page-size=16384 \
  -Wl,--no-undefined \
  "$src" -ldl \
  -o "$built"
"$ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip" --strip-all "$built"

if [ "$check" = 1 ]; then
  if ! cmp -s "$built" "$out"; then
    echo "error: $out is stale; run scripts/build-python-launcher.sh" >&2
    exit 1
  fi
  echo "launcher asset is up to date"
  exit 0
fi

mkdir -p "$(dirname "$out")"
cp "$built" "$out"
chmod 755 "$out"
echo "wrote $out"
file "$out"
