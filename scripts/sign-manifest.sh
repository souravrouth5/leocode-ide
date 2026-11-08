#!/usr/bin/env bash
# Sign a runtime manifest with the offline Ed25519 key.
#
#   LEOCODE_MANIFEST_KEY=/secure/path/key.pem scripts/sign-manifest.sh \
#       runtime-manifests/versions/python-3.11.9.json
#
# The private key must never exist on a CI runner; signing happens offline.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <manifest.json>" >&2
  exit 2
fi

MANIFEST="$1"
KEY="${LEOCODE_MANIFEST_KEY:-$HOME/.leocode/manifest-signing-key.pem}"

[[ -f "$MANIFEST" ]] || { echo "no such manifest: $MANIFEST" >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "missing signing key: $KEY" >&2; exit 1; }

openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$MANIFEST" -out "$MANIFEST.sig"
echo "signed: $MANIFEST.sig"
