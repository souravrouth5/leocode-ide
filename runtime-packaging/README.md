# Runtime packaging

Build scripts for the runtime artifacts LeoCode installs.

## Track C2 (MVP)

1. **CPython** — cross-compiled with the Android NDK for `arm64-v8a`, prefix
   `/data/data/dev.leocode/files/usr`, configured with
   `--prefix=/data/data/dev.leocode/files/usr --disable-shared --without-ensurepip=false`.
2. **pip bootstrap** — `ensurepip` plus a pinned `pip`/`setuptools`/`wheel` set.
3. **CA bundle** — `ca-certificates` PEM, referenced via `SSL_CERT_FILE`.
4. **Wheels** — native packages built in CI with the same NDK + Python headers, tagged
   `android_aarch64`, published to the wheel index.
5. **Manifest** — hash + size + signature produced by `scripts/sign-manifest.sh`.

Outputs go to `out/` (git-ignored) and are uploaded as CI artifacts.

## Track C1 (deferred)

Fork of `termux-packages` with `TERMUX_PREFIX=/data/data/dev.leocode/files/usr`. Only if
users need broad `pip`/npm compatibility. Expect several weeks of build-system patching and
1–3 days/month of maintenance. Do not start before C2 proves the product.

## Reproducibility

- Record NDK version, Python version, wheel hashes, and build container digest.
- Every artifact hash is committed in `runtime-manifests/versions/*.json`.
- CI builds on a clean runner; the laptop is never the source of truth.
