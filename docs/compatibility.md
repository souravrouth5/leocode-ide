# Python compatibility matrix

Filled in during Tasks 24–26 (plan v9). One row per package, per device. Never generalise from one device.

## Baseline

| Item | Value |
|---|---|
| CPython version | **3.14.10** (official python.org `aarch64-linux-android` build, `sha256 423c80b9…`) |
| Build | Official python.org build + LeoCode `python3` launcher (NDK 28.2.13676358), 16 KB aligned (80 ELFs checked in CI) |
| Prefix | `<filesDir>/usr`, computed at runtime (user 0: `/data/user/0/dev.leocode/files/usr`) |
| libc | Bionic |
| pip | `ensurepip` (26.2.2 observed on D1 and D2) |
| CA bundle | certifi, via `SSL_CERT_FILE` |
| venv | `python -m venv`, internal storage only |
| Compiler on device | **none** (MVP) |
| Native packages | LeoCode Android wheels (`cp314-cp314-android_24_arm64_v8a`), built by `runtime-packaging/build_android_wheel.py`; PyPI Android wheels are accepted when the tag matches (proved with `charset-normalizer`) |

## Results

| Package | Type | D1 (A9) | D2 (A15) | Notes |
|---|---|---|---|---|
| requests | pure | **PASS** | **PASS** | 2.34.2 from PyPI; `https://example.com` returned `200` |
| flask | pure | | | |
| rich | pure | | | |
| pygments | pure | **PASS** | **PASS** | 2.21.0; `bin/pygmentize` shebang points at the venv python |
| markupsafe | native | **PASS** | **PASS** | 3.0.2 from the LeoCode wheel; `_speedups` imports; PyPI has no Android wheel |
| charset-normalizer | native | **PASS** | **PASS** | 3.5.2 from PyPI; pip selected `cp314-cp314-android_24_arm64_v8a` and `md...so` imports |
| ujson | native | | | recipe to add with `build_android_wheel.py` |
| numpy | native | | | check for a PyPI Android wheel; else unsupported |
| cryptography | native | | | needs OpenSSL linkage |

## Known limitations

- No `gcc`/`clang` on device: sdists with C code cannot build. `pip install` succeeds only for
  pure-Python packages and Android wheels.
- manylinux / musllinux wheels never install (wrong libc).
- Console scripts rely on `#!` lines limited to ~127 bytes; prefer `python -m pkg`.
- `pip` may need `--no-cache-dir` on low-storage devices.
- Android kills long `pip` runs under memory pressure or when backgrounded (phantom-process
  killer on Android 12+); the session service (Task 10) reduces this.

## Wheel index

The `python-runtime` CI job (Task 24) builds `markupsafe` 3.0.2 with the NDK
against the runtime's headers and publishes a static PEP 503 index:

```
index/
  index.html
  markupsafe/
    index.html
  wheels/
    markupsafe-3.0.2-cp314-cp314-android_24_arm64_v8a.whl
```

The tag comes from the official build's `sysconfig.get_platform()`
(`android-24-arm64_v8a`); pip on Android 9/15 advertises the same tag family and
accepts the wheel. `pip` is pointed at the index with `--extra-index-url` and
`--only-binary=:all:` for native packages. The release also carries a
`SHA256SUMS` file; the artifact, manifest and signature are published to the
`python-runtime` prerelease.

The wheel was installed and imported on both phones during the Task 26 probes
(2026-11-21): `markupsafe` 3.0.2 from this wheel imports `_speedups` on D1
(Android 9) and D2 (Android 15). PyPI Android wheels are checked in the same
pass; `charset-normalizer` 3.5.2 was selected from PyPI on both phones, so a
PyPI wheel that matches the device tags does not need our index. The production
T15 harness run is still being finished (see `PROGRESS.md`).
