#!/usr/bin/env bash
# Verify a signed runtime manifest against the public key embedded in the app.
#
#   scripts/verify-manifest.sh runtime-manifests/versions/python-3.11.9.json \
#       docs/keys/manifest-public.pem
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <manifest.json> <public-key.pem>" >&2
  exit 2
fi

MANIFEST="$1"
PUBKEY="$2"

[[ -f "$MANIFEST.sig" ]] || { echo "missing signature: $MANIFEST.sig" >&2; exit 1; }

openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin \
  -in "$MANIFEST" -sigfile "$MANIFEST.sig"
