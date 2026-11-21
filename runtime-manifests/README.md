# Runtime manifests

Signed, versioned metadata describing an installable runtime. The app never executes a
downloaded artifact before the hash **and** the signature in these manifests verify.

## Layout

```
schema/manifest.schema.json
versions/<runtime>-<version>.json       # unsigned body, committed
versions/<runtime>-<version>.json.sig   # Ed25519 signature (base64), produced at release time
```

The APK carries a copy of the manifest and signature under
`android/app/src/main/assets/runtime/<id>.json(.sig)`. `RuntimeInstaller` verifies the
signature with the public key compiled into `RuntimeKeys.kt` before it downloads anything,
so replacing the asset inside a modified APK does not help an attacker.

## Signing

The public key is embedded in the APK (`docs/decisions/README.md`, D-009-adjacent)
and committed as [`docs/keys/manifest-public.pem`](../docs/keys/manifest-public.pem).
The private key lives in the protected `python-runtime` GitHub environment as
`RUNTIME_SIGNING_KEY`; the release job writes it to a temporary file, signs,
verifies, and removes it. Developers sign offline with
`~/.config/leocode/runtime-signing.pem`. Release procedure:

```bash
scripts/sign-manifest.sh runtime-manifests/versions/python-3.14.10.json
scripts/verify-manifest.sh runtime-manifests/versions/python-3.14.10.json docs/keys/manifest-public.pem
```

The signature covers the exact manifest bytes and is stored as base64 in `<manifest>.sig`.
`sign-manifest.sh` also prints the raw public key and its SPKI SHA-256, which must match
`RuntimeKeys.PYTHON` and `RuntimeKeys.FINGERPRINT`. The `python-runtime` CI job
re-signs the manifest with the protected key and publishes the tarball,
manifest, signature, `markupsafe` wheel and `SHA256SUMS` to the `python-runtime`
prerelease.

Rollback protection: `versionCode` must be strictly greater than the installed one; the app
refuses older manifests even if correctly signed.

See plan §7.2 for the field semantics and §7.4 for integrity requirements.
