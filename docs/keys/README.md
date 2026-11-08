# Keys

Nothing secret is stored in this repository.

| Key | Where it lives | Purpose |
|---|---|---|
| Runtime-manifest signing (Ed25519) | Offline; public half embedded in the APK | Authenticates `runtime-manifests/versions/*.json` |
| APK release signing | Offline; password-managed | Lets users update in place |
| SSH user keys | Generated on device; Keystore-wrapped | Git authentication (D-009) |

Generate the manifest key pair once:

```bash
openssl genpkey -algorithm ED25519 -out "$HOME/.leocode/manifest-signing-key.pem"
openssl pkey -in "$HOME/.leocode/manifest-signing-key.pem" -pubout -out manifest-public.pem
```

Commit `manifest-public.pem` here as `docs/keys/manifest-public.pem` when it exists; never commit
the private key. Signing is offline, never in CI (see `.github/workflows/ci.yml`).
