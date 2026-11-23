#!/usr/bin/env bash
# Map a release tag to Android versionName/versionCode (Task 28).
#
#   scripts/version-from-tag.sh v0.1.0-rc2
#   VERSION_NAME=0.1.0-rc2
#   VERSION_CODE=1002
#
# Scheme: major*1_000_000 + minor*1_000 + patch*10 + prerelease.
# `-rcN` uses N (0-8); a final release uses 9, so `v0.1.0-rc2` (1002) sorts
# before `v0.1.0` (1009). Components are canonical decimal (no leading zeros):
# major 0-2099, minor 0-99, patch 0-99, which keeps every tag code below
# 2_099_100_000 and leaves 2_100_000_000+ for nightlies.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 vX.Y.Z[-rcN]" >&2
  exit 2
fi

tag="${1#v}"
if [[ ! "$tag" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-rc(0|[1-8]))?$ ]]; then
  echo "error: '$1' is not a canonical release tag (expected vX.Y.Z or vX.Y.Z-rc0..8)" >&2
  exit 2
fi

major="${BASH_REMATCH[1]}"
minor="${BASH_REMATCH[2]}"
patch="${BASH_REMATCH[3]}"
pre="9"
if [[ -n "${BASH_REMATCH[5]:-}" ]]; then
  pre="${BASH_REMATCH[5]}"
fi

if (( ${#major} > 4 || ${#minor} > 2 || ${#patch} > 2 )); then
  # Reject before bash arithmetic: a 20-digit component would wrap and could
  # otherwise pass the range check below.
  echo "error: $tag is outside the supported version range" >&2
  exit 2
fi
if (( major > 2099 || minor > 99 || patch > 99 )); then
  echo "error: $tag is outside the supported version range" >&2
  exit 2
fi

code=$(( major * 1000000 + minor * 1000 + patch * 10 + pre ))
if (( code <= 0 || code >= 2100000000 )); then
  echo "error: $tag maps to an invalid versionCode ($code)" >&2
  exit 2
fi
echo "VERSION_NAME=$tag"
echo "VERSION_CODE=$code"
