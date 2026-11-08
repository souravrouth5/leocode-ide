# Runtime manifests

Signed, versioned metadata describing an installable runtime. The app never executes a
downloaded artifact before the hash **and** the signature in these manifests verify.

## Layout

```
schema/manifest.schema.json
versions/<runtime>-<version>.json       # unsigned body, committed
versions/<runtime>-<version>.json.sig   # Ed25519 signature, produced at release time
```

## Signing

The public key is embedded in the APK (`docs/decisions/README.md`, D-009-adjacent).
Private key lives offline and is never in CI. Release procedure:

```bash
scripts/sign-manifest.sh runtime-manifests/versions/python-3.11.9.json
```

Rollback protection: `versionCode` must be strictly greater than the installed one; the app
refuses older manifests even if correctly signed.

See plan §7.2 for the field semantics and §7.4 for integrity requirements.
