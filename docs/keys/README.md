# Keys

Nothing secret is stored in this repository.

| Key | Where it lives | Purpose |
|---|---|---|
| Runtime-manifest signing (Ed25519) | Public half: [`manifest-public.pem`](manifest-public.pem); private half: offline and in the protected `python-runtime` GitHub environment (`RUNTIME_SIGNING_KEY`) | Authenticates `runtime-manifests/versions/*.json` |
| APK release signing | Offline; password-managed | Lets users update in place |
| SSH user keys | Generated on device; Keystore-wrapped | Git authentication (D-009) |

Generate the manifest key pair once:

```bash
openssl genpkey -algorithm ED25519 -out "$HOME/.config/leocode/runtime-signing.pem"
chmod 600 "$HOME/.config/leocode/runtime-signing.pem"
openssl pkey -in "$HOME/.config/leocode/runtime-signing.pem" \
  -pubout -out docs/keys/manifest-public.pem
```

The committed public key must match `RuntimeKeys.PYTHON` and
`RuntimeKeys.FINGERPRINT` in the app. Its SPKI fingerprint is:

```
3552be7042e2dbb9a0088580db46fd2adb23139ad5b33cee11aef7209a96c95e
```

Check it with:

```bash
openssl pkey -pubin -in docs/keys/manifest-public.pem -outform DER \
  | sha256sum
```

Signing happens offline for releases, or in CI from the protected environment:

- Locally: `scripts/sign-manifest.sh <manifest.json>` uses
  `$LEOCODE_MANIFEST_KEY` (default `~/.config/leocode/runtime-signing.pem`).
- CI: `python-runtime-release` writes `RUNTIME_SIGNING_KEY` to a temporary
  file, signs, verifies against `manifest-public.pem`, and deletes the file.

Never commit the private key. Fork PRs never receive the environment secret;
the release step skips with a notice when it is absent.
