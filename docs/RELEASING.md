# Releasing LeoCode

Task 28. A release is a signed, R8-shrunk APK plus a signed update manifest, a CycloneDX SBOM and
checksums. The app can only update itself with an APK signed by the same certificate and described
by a manifest signed with the release Ed25519 key, so both keys are long-lived and must be backed
up.

## Keys and what they protect

| Key | Where it lives | What it proves |
|---|---|---|
| Android release keystore (`release.jks`, alias `leocode`) | protected `release` environment (`RELEASE_STORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`) | Android accepts the APK as an update to an installed LeoCode. Losing it means every user must uninstall and reinstall. |
| Release manifest Ed25519 key (`release-signing.pem`) | protected `release` environment (`RELEASE_SIGNING_KEY`); public half at `docs/keys/release-manifest-public.pem` | The app trusts `release.json` fetched over the network. The raw public key is compiled into `ReleaseKeys.RELEASE`. |

The current certificate SHA-256:

```
2B:29:4E:12:D9:6D:B8:74:48:E6:ED:32:01:9D:C5:29:DD:2E:CE:DC:0D:58:7E:CB:C9:88:9C:73:7A:B6:BD:AF
```

The release manifest public key (`docs/keys/release-manifest-public.pem`, raw base64
`ADXNhDgqluTWa5lOPsmww5Rc+Fgg3Zolg9JnZ9KJW3A=`) has SubjectPublicKeyInfo SHA-256
`87e1a3b8f4f5ebb9045ae06d617b42104b02211a01964b03a232c0c46b204142`. The key fingerprint is
checked by `ReleaseManifestTest`; the release job verifies the APK certificate against the value
above before it publishes. Changing either without a matching release build makes every update check
fail closed.

### One-time setup (owner)

Generate the keys outside the repository. The passwords are printed once; store them in a
password manager, not in git.

```bash
mkdir -p ~/.config/leocode
PASS="$(openssl rand -hex 16)"
keytool -genkeypair -noprompt \
  -keystore ~/.config/leocode/release.jks -alias leocode \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=LeoCode, OU=Release, O=LeoCode, L=Bengaluru, ST=Karnataka, C=IN"
cat > ~/.config/leocode/release.properties <<EOF
storeFile=$HOME/.config/leocode/release.jks
storePassword=$PASS
keyAlias=leocode
keyPassword=$PASS
EOF
chmod 600 ~/.config/leocode/release.jks ~/.config/leocode/release.properties
keytool -list -v -keystore ~/.config/leocode/release.jks -storepass "$PASS" | grep SHA256

openssl genpkey -algorithm ED25519 -out ~/.config/leocode/release-signing.pem
chmod 600 ~/.config/leocode/release-signing.pem
openssl pkey -in ~/.config/leocode/release-signing.pem -pubout \
  -out docs/keys/release-manifest-public.pem
```

Then, in GitHub **Settings → Environments**, create an environment named `release`, add required
reviewers if desired, and add these environment secrets:

| Secret | Value |
|---|---|
| `RELEASE_STORE_BASE64` | `base64 -w0 ~/.config/leocode/release.jks` |
| `RELEASE_STORE_PASSWORD` | the keystore password |
| `RELEASE_KEY_ALIAS` | `leocode` |
| `RELEASE_KEY_PASSWORD` | the key password (same as the store in the snippet above) |
| `RELEASE_SIGNING_KEY` | the full PEM text of `~/.config/leocode/release-signing.pem` |

Back up `release.jks`, `release.properties` and `release-signing.pem` offline. Losing the keystore
is unrecoverable for installed users; losing the manifest key means shipping a new public key in an
app update before new manifests can be trusted.

A manual `workflow_dispatch` publishes a nightly only from `main` (or a `v*` tag). Restrict the
`release` environment's deployment branches to `main` and `v*` tags so a feature branch can never
receive the signing secrets.

## Version numbers

`scripts/version-from-tag.sh vX.Y.Z[-rcN]` maps a tag to:

```
versionCode = major*1_000_000 + minor*1_000 + patch*10 + prerelease
```

`-rcN` uses `N` (0–8); a final release uses `9`. So `v0.1.0-rc1` is code `1001`, `v0.1.0-rc2` is
`1002`, and `v0.1.0` is `1009`. The code increases monotonically within a line, and the tag is the
single source of truth for both fields. Tags must be canonical decimal: `v01.2.3`, `v0.1.0-rc01`
and `v0.1.0-rc9` are rejected rather than mapped onto a colliding code.

Nightly builds are a separate preview channel: `0.0.0-nightly.<run_number>`, code
`2_100_000_000 + run_number`, published under the moving `nightly` tag with fixed asset names
(`leocode-nightly.apk`, `leocode-nightly.cdx.json`). A nightly is built on the daily 03:00 UTC
schedule, on a manual dispatch from `main`, and on every push to `main` — so the pipeline also
exercises the R8 build on a merge instead of only at tag time. The band starts above the highest
possible tag code (`2_099_099_999`), so nightly-to-nightly updates always move forward without
colliding with a future `v2.x` tag. Nightlies embed the `nightly` manifest URL rather than
`releases/latest`, so a nightly install keeps receiving nightlies. Moving back to a stable build
requires installing a stable APK manually (or uninstalling); this is deliberate — a nightly should
never silently downgrade to an older stable code.

## Cutting a release

1. Update `PROGRESS.md` / release notes and merge to `main`.
2. Tag the commit and push the tag:

   ```bash
   git tag -a v0.1.0-rc1 -m "LeoCode 0.1.0-rc1"
   git push origin v0.1.0-rc1
   ```

3. The `release` job downloads the web bundle built by the `web` job, assembles the signed release
   APK with R8, verifies its certificate and version against the tag, signs `release.json`, writes
   the SBOM and publishes the GitHub release. Tags containing `-rc` are published as prereleases.
4. Verify the published assets:

   ```bash
   curl -L -O https://github.com/souravrouth5/leocode-ide/releases/download/v0.1.0-rc1/release.json
   curl -L -O https://github.com/souravrouth5/leocode-ide/releases/download/v0.1.0-rc1/release.json.sig
   curl -L -O https://github.com/souravrouth5/leocode-ide/releases/download/v0.1.0-rc1/SHA256SUMS
   scripts/verify-manifest.sh release.json docs/keys/release-manifest-public.pem
   sha256sum -c --ignore-missing SHA256SUMS
   ```

A prerelease is **not** what `releases/latest` points at. Stable builds therefore only see stable
releases by default; to test an rc build, build it with
`LEOCODE_UPDATE_URL=…/releases/download/v0.1.0-rc1/release.json` (the device demo below does this
with a local `file://` mirror).

If the `release` secrets are missing, a nightly logs a notice and skips the build instead of
failing `main`; a tag release fails closed, because publishing an unsigned or debug-signed APK is
worse than a red run. Pull requests never receive the environment secrets.

## Local release build

`scripts/build-release.sh` reads `~/.config/leocode/release.properties`, refuses to build without a
keystore unless `LEOCODE_ALLOW_DEBUG_SIGNING=1`, and writes
`dist/release/leocode-<versionCode>.apk`:

```bash
scripts/sync-web.sh
scripts/build-release.sh 0.1.0-rc1 1001
```

Make the manifest for a mirror:

```bash
scripts/make-release-manifest.py \
  --apk dist/release/leocode-1001.apk \
  --version-name 0.1.0-rc1 --version-code 1001 \
  --url file:///sdcard/Download/leocode-update/leocode-1001.apk \
  --notes "Device demo" \
  --out dist/release/release.json
scripts/sign-release.sh dist/release/release.json
```

`scripts/sign-release.sh` verifies the signature against the committed public key immediately, so a
wrong key fails before anything is published.

## Device self-update demo

The APK uses the manifest URL compiled at build time. For an offline demo, build both sides of the
update and mirror the newer one:

```bash
scripts/sync-web.sh
scripts/build-release.sh 0.1.0-rc1 1001 file:///sdcard/Download/leocode-update/release.json
scripts/build-release.sh 0.1.0-rc2 1002 file:///sdcard/Download/leocode-update/release.json

# The manifest always describes the newer APK.
scripts/make-release-manifest.py \
  --apk dist/release/leocode-1002.apk \
  --version-name 0.1.0-rc2 --version-code 1002 \
  --url file:///sdcard/Download/leocode-update/leocode-1002.apk \
  --notes "Device demo" --out dist/release/release.json
scripts/sign-release.sh dist/release/release.json

adb install -r dist/release/leocode-1001.apk
adb shell mkdir -p /sdcard/Download/leocode-update
adb push dist/release/leocode-1002.apk dist/release/release.json \
  dist/release/release.json.sig /sdcard/Download/leocode-update/
adb shell appops set dev.leocode REQUEST_INSTALL_PACKAGES allow
# file:// reads need shared-storage access; https releases do not.
adb shell pm grant dev.leocode android.permission.READ_EXTERNAL_STORAGE
```

Then Settings › About › Updates → **Check for updates** should offer rc2, and **Download and
install** must open Android's installer. Android still asks the user to confirm; the app cannot
bypass that prompt.

On Android 9 (API 28), a build older than rc2 cannot verify an APK archive's signer — the platform
only collects archive certificates for `GET_SIGNATURES`. rc2 asks for both flags and falls back to
`PackageInfo.signatures`. To demo on API 28, install rc2 with `adb install -r`, then use rc2→rc3 as
the in-app update.

## SBOM

`./gradlew :app:exportReleaseDependencies` writes the resolved `releaseRuntimeClasspath` Maven
coordinates. `scripts/make-sbom.py` combines them with the production packages in
`web/package-lock.json` into a deterministic CycloneDX 1.5 JSON file. CI publishes it as
`leocode-<code>.cdx.json` next to a tag APK, or `leocode-nightly.cdx.json` for a nightly.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `LEOCODE_REQUIRE_RELEASE_SIGNING=1 but LEOCODE_RELEASE_STORE_FILE is not set` | The `release` environment secrets are missing; add them or run with `LEOCODE_ALLOW_DEBUG_SIGNING=1` locally. |
| App says the manifest signature is invalid | The manifest was edited after signing, or `release-signing.pem` does not match `docs/keys/release-manifest-public.pem`. Re-run `scripts/sign-release.sh` with the right key. |
| App says the update is not signed with this app's certificate | The APK was built with the debug key or a different keystore. Rebuild with the release keystore; Android cannot install across certificates. On Android 9/10/13, builds before rc2 also hit this because the platform only reads an archive's certificates when `GET_SIGNATURES` is requested. |
| `the update's signature could not be read` | The downloaded file is not a valid APK, or the platform refused to parse its signature. Rebuild and re-sign the APK; check `adb logcat -s LeoCodeUpdate`. |
| Installer does not open | Grant "Install unknown apps" for LeoCode (the app opens the per-app settings screen and reports `E_PERMISSION`). |
| R8 release crashes where debug works | Add a keep rule to `android/app/proguard-rules.pro`, rebuild, and run `scripts/smoke.sh` on both phones. JGit, SSHD, Bouncy Castle and kotlinx.serialization are the usual suspects. |
