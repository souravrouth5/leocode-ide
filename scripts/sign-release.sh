#!/usr/bin/env bash
# Sign `release.json` with the offline release key (Task 28).
#
#   LEOCODE_RELEASE_KEY=/secure/path/release-signing.pem \
#       scripts/sign-release.sh dist/release.json
#
# The signature covers the exact manifest bytes and is written as base64 in
# `release.json.sig`, which is what `UpdateChecker` fetches. The public half is
# committed at docs/keys/release-manifest-public.pem and compiled into
# `ReleaseKeys.kt`; rotating the key means updating all three together.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
manifest="${1:-}"
key="${LEOCODE_RELEASE_KEY:-$HOME/.config/leocode/release-signing.pem}"

if [[ -z "$manifest" ]]; then
  echo "usage: $0 <release.json>" >&2
  exit 2
fi
if [[ ! -f "$manifest" ]]; then
  echo "error: no such manifest: $manifest" >&2
  exit 1
fi
if [[ ! -f "$key" ]]; then
  echo "error: missing release signing key: $key" >&2
  echo "       set LEOCODE_RELEASE_KEY or create ~/.config/leocode/release-signing.pem" >&2
  exit 1
fi

LEOCODE_MANIFEST_KEY="$key" "$root/scripts/sign-manifest.sh" "$manifest"
"$root/scripts/verify-manifest.sh" "$manifest" "$root/docs/keys/release-manifest-public.pem"
echo "verified against docs/keys/release-manifest-public.pem"
