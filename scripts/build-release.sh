#!/usr/bin/env bash
# Build one signed, shrunk release APK (Task 28).
#
#   scripts/build-release.sh 0.1.0-rc1 1001
#   scripts/build-release.sh 0.1.0-rc1 1001 file:///sdcard/Download/leocode-update/release.json
#
# Signing comes from the protected `release` environment in CI or from
# ~/.config/leocode/release.properties locally (see docs/RELEASING.md). A build
# without a keystore fails instead of silently producing a debug-signed APK.
#
# Output: dist/release/leocode-<versionCode>.apk
#         android/app/build/reports/release-dependencies.txt (for the SBOM)
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version_name="${1:-}"
version_code="${2:-}"
update_url="${3:-}"

if [[ -z "$version_name" || -z "$version_code" ]]; then
  echo "usage: $0 <version-name> <version-code> [update-manifest-url]" >&2
  exit 2
fi
if [[ "$version_name" =~ [[:space:]] ]]; then
  echo "error: version name must not contain whitespace: '$version_name'" >&2
  exit 2
fi
if [[ ! "$version_code" =~ ^[1-9][0-9]*$ ]] ||
   (( ${#version_code} > 10 )) ||
   { (( ${#version_code} == 10 )) && [[ "$version_code" > "2147483647" ]]; }; then
  echo "error: version code must be a positive 32-bit integer: '$version_code'" >&2
  exit 2
fi

# A tag-shaped name has exactly one valid code; refuse a mismatched pair so a
# local build cannot produce `0.1.0-rc1` with the code of another release.
tag="v${version_name#v}"
if [[ "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc(0|[1-8]))?$ ]]; then
  expected="$("$root/scripts/version-from-tag.sh" "$tag" | sed -n 's/^VERSION_CODE=//p')"
  if [[ "$expected" != "$version_code" ]]; then
    echo "error: $version_name maps to versionCode $expected, not $version_code" >&2
    exit 2
  fi
fi

props="$HOME/.config/leocode/release.properties"
if [[ -f "$props" && -z "${LEOCODE_RELEASE_STORE_FILE:-}" ]]; then
  # Local convenience only: CI exports these from the protected environment.
  set -a
  # shellcheck disable=SC1090
  . "$props"
  set +a
  export LEOCODE_RELEASE_STORE_FILE="$storeFile"
  export LEOCODE_RELEASE_STORE_PASSWORD="$storePassword"
  export LEOCODE_RELEASE_KEY_ALIAS="$keyAlias"
  export LEOCODE_RELEASE_KEY_PASSWORD="$keyPassword"
fi

if [[ -z "${LEOCODE_RELEASE_STORE_FILE:-}" && "${LEOCODE_ALLOW_DEBUG_SIGNING:-0}" != "1" ]]; then
  echo "error: no release keystore configured." >&2
  echo "       set LEOCODE_RELEASE_STORE_FILE/PASSWORD/KEY_ALIAS/KEY_PASSWORD," >&2
  echo "       or set LEOCODE_ALLOW_DEBUG_SIGNING=1 for a local smoke build." >&2
  exit 1
fi
if [[ -z "${LEOCODE_RELEASE_STORE_FILE:-}" ]]; then
  # Explicit debug-signed smoke build: let Gradle fall back instead of failing.
  export LEOCODE_REQUIRE_RELEASE_SIGNING=0
fi

export LEOCODE_VERSION_NAME="$version_name"
export LEOCODE_VERSION_CODE="$version_code"
export LEOCODE_REQUIRE_RELEASE_SIGNING="${LEOCODE_REQUIRE_RELEASE_SIGNING:-1}"
if [[ -n "$update_url" ]]; then
  export LEOCODE_UPDATE_URL="$update_url"
fi

cd "$root/android"
./gradlew :app:assembleRelease :app:exportReleaseDependencies

apk="$root/android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$apk" ]] || { echo "error: release APK not produced" >&2; exit 1; }

out="$root/dist/release/leocode-$version_code.apk"
mkdir -p "$(dirname "$out")"
cp "$apk" "$out"

echo
echo "apk:     ${out#$root/}"
echo "sha256:  $(sha256sum "$out" | cut -d' ' -f1)"
echo "size:    $(stat -c %s "$out") bytes"
