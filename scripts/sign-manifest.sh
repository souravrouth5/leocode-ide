#!/usr/bin/env bash
# Sign a runtime manifest with the offline Ed25519 key (Task 25).
#
#   LEOCODE_MANIFEST_KEY=/secure/path/key.pem scripts/sign-manifest.sh \
#       runtime-manifests/versions/python-3.11.9.json
#
# The signature covers the exact bytes of the manifest, so edit the JSON first
# and re-run this script afterwards. It is written as base64 in `<manifest>.sig`
# because that is what the app's `ManifestVerifier` reads (and it survives git
# and editors without corruption).
#
# The private key is never committed: CI writes it from the protected
# `python-runtime` environment; developers keep it outside the repository
# (default: ~/.config/leocode/runtime-signing.pem).
#
# Prints the raw public key and its SubjectPublicKeyInfo SHA-256 so
# `RuntimeKeys.kt` can be updated when the key rotates.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <manifest.json>" >&2
  exit 2
fi

MANIFEST="$1"
KEY="${LEOCODE_MANIFEST_KEY:-$HOME/.config/leocode/runtime-signing.pem}"

[[ -f "$MANIFEST" ]] || { echo "no such manifest: $MANIFEST" >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "missing signing key: $KEY" >&2; exit 1; }

tmp="$(mktemp)"
pub_der="$(mktemp)"
trap 'rm -f "$tmp" "$pub_der"' EXIT

openssl pkeyutl -sign -inkey "$KEY" -rawin -in "$MANIFEST" -out "$tmp"
base64 -w0 "$tmp" > "$MANIFEST.sig"
echo >> "$MANIFEST.sig"

openssl pkey -in "$KEY" -pubout -outform DER -out "$pub_der"
echo "signed:  $MANIFEST.sig ($(base64 -d < "$MANIFEST.sig" | wc -c) bytes, base64)"
echo "public:  $(tail -c 32 "$pub_der" | base64 -w0)"
echo "sha256:  $(sha256sum "$pub_der" | cut -d' ' -f1)"
