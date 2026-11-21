#!/usr/bin/env bash
# Verify a signed runtime manifest against a public key (Task 25).
#
#   scripts/verify-manifest.sh runtime-manifests/versions/python-3.11.9.json \
#       docs/keys/manifest-public.pem
#
# The public key may be a PEM/SubjectPublicKeyInfo file or a raw 32-byte
# Ed25519 key (as printed by sign-manifest.sh). The signature is base64.
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <manifest.json> <public-key.pem|raw-32-byte-key>" >&2
  exit 2
fi

MANIFEST="$1"
PUBKEY="$2"

[[ -f "$MANIFEST.sig" ]] || { echo "missing signature: $MANIFEST.sig" >&2; exit 1; }
[[ -f "$PUBKEY" ]] || { echo "missing public key: $PUBKEY" >&2; exit 1; }

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
base64 -d < "$MANIFEST.sig" > "$tmp"

# A raw Ed25519 key is 32 bytes; wrap it in the SubjectPublicKeyInfo prefix so
# OpenSSL accepts it. A PEM file is used as-is.
if [[ $(wc -c < "$PUBKEY") -eq 32 ]]; then
  pub_pem="$(mktemp)"
  trap 'rm -f "$tmp" "$pub_pem"' EXIT
  # Ed25519 SPKI prefix (RFC 8410): 302a300506032b6570032100.
  { printf '\x30\x2a\x30\x05\x06\x03\x2b\x65\x70\x03\x21\x00'; cat "$PUBKEY"; } \
    | openssl pkey -pubin -inform DER -out "$pub_pem" 2>/dev/null
  PUBKEY="$pub_pem"
fi

openssl pkeyutl -verify -pubin -inkey "$PUBKEY" -rawin \
  -in "$MANIFEST" -sigfile "$tmp"
