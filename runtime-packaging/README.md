# Runtime packaging

Tooling that verifies the runtime artifact and builds the native wheels LeoCode
installs (Task 24).

## Source of truth

The Python runtime is the **official python.org Android `aarch64` build**
(D-012, PEP 738), pinned in
[`../runtime-manifests/versions/python-3.14.10.json`](../runtime-manifests/versions/python-3.14.10.json)
by URL, sha256 and size. We do not cross-compile CPython any more;
`scripts/build-python.sh` was retired in Task 24.

The app adds the pieces the official package leaves out at install time:

1. **Launcher** — `android/app/src/main/cpp/python_launcher.c`, built by
   `scripts/build-python-launcher.sh`, copied to `<prefix>/bin/python3`. It
   derives `PYTHONHOME` from `/proc/self/exe` and `dlopen()`s `libpython`.
2. **CA bundle** — `android/app/src/main/assets/runtime/cacert.pem`, copied to
   `<prefix>/etc/ca-certificates.pem`.
3. **pip** — `ensurepip` inside the installed tree.

Because of that, CI does not repackage the tarball; it verifies and mirrors the
upstream bytes.

## Verification

```bash
python3 scripts/check-runtime-artifact.py \
  --manifest runtime-manifests/versions/python-3.14.10.json
```

The checker downloads (or reuses) the tarball, verifies size and sha256, walks
the tar safely, checks the layout (`libpython3.*.so`, stdlib, headers), measures
the pruned install against `install.installedSize`, and runs
`scripts/check-elf-alignment.sh` over every shared object. The signature is
checked separately:

```bash
scripts/verify-manifest.sh \
  runtime-manifests/versions/python-3.14.10.json \
  docs/keys/manifest-public.pem
```

## Wheels

Native packages are compiled with the NDK against the artifact's headers and
`libpython`, then packed by `build_android_wheel.py` with a pinned recipe:

```bash
python3 runtime-packaging/build_android_wheel.py \
  --recipe runtime-packaging/wheels/markupsafe.json \
  --python-prefix /tmp/runtime/prefix \
  --ndk "$ANDROID_HOME/ndk/28.2.13676358" \
  --out runtime-packaging/out/wheels
```

The official build reports `sysconfig.get_platform()` as
`android-24-arm64_v8a`, so wheels are tagged
`cp314-cp314-android_24_arm64_v8a`; pip on Android 9/15 advertises that tag and
accepts the wheel. The extension suffix stays
`.cpython-314-aarch64-linux-android.so`.

`build_wheel_index.py` turns the wheel directory into a static PEP 503 index:

```bash
python3 runtime-packaging/build_wheel_index.py \
  --wheels runtime-packaging/out/wheels \
  --out runtime-packaging/out/index
```

Serve `index/` as a static site and point pip at it with
`--extra-index-url` plus `--only-binary=:all:` for native packages.

## CI

- **`python-runtime`** runs on every push/PR: verify artifact + signature,
  build the `markupsafe` wheel, check its `.so` alignment, build the index, and
  upload `python-runtime` artifacts.
- **`python-runtime-release`** runs on `main`/`workflow_dispatch` with the
  protected `python-runtime` environment. It signs the manifest from
  `RUNTIME_SIGNING_KEY`, verifies it against `docs/keys/manifest-public.pem`,
  and publishes the tarball, manifest, signature, wheel and `SHA256SUMS` to the
  `python-runtime` prerelease. Without the secret it skips with a notice, so
  fork PRs never see it.

## Reproducibility

- Artifact: version + sha256 in `runtime-manifests/versions/*.json`.
- Wheel sources: sdist URL + sha256 in `runtime-packaging/wheels/*.json`.
- Toolchain: NDK `28.2.13676358` (the pin in `android/gradle.properties`).
- Every ELF is checked for 16 KB `LOAD` alignment before publication.

Outputs go to `out/` (git-ignored). Track C1 (a `termux-packages` fork) stays
deferred; see the plan for when broad `pip`/npm compatibility would justify it.
