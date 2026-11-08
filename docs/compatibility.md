# Python compatibility matrix

Filled in during Phase 0C. One row per package, per device. Never generalise from one device.

## Baseline

| Item | Value |
|---|---|
| CPython version | TBD (target 3.11.x) |
| Build | NDK r27, `android-aarch64`, prefix `/data/data/dev.leocode/files/usr` |
| libc | Bionic |
| pip | bundled (`ensurepip`) |
| venv | `python -m venv`, internal storage only |
| Compiler on device | **none** (MVP) |
| Native packages | only wheels published by LeoCode CI |

## Results

| Package | Type | D1 (A9) | D2 (A11) | D3 (A14+) | Notes |
|---|---|---|---|---|---|
| requests | pure | | | | |
| flask | pure | | | | |
| rich | pure | | | | |
| markupsafe | native | | | | CI-built wheel |
| ujson | native | | | | CI-built wheel |
| numpy | native | | | | expected: no wheel → unsupported |
| cryptography | native | | | | needs OpenSSL build |

## Known limitations

- No `gcc`/`clang` on device: sdists cannot build. `pip install` succeeds only for pure-Python
  packages and LeoCode-published wheels.
- manylinux / musllinux wheels never install (wrong libc).
- Console scripts rely on `#!` lines limited to ~127 bytes; prefer `python -m pkg`.
- `pip` may need `--no-cache-dir` on low-storage devices.
- Android kills `pip` builds under memory pressure; document `PIP_NO_BUILD_ISOLATION` only if a
  compiler is ever shipped.

## Wheel index

`runtime-packaging/wheels/` produces:

```
index/
  android-aarch64/
    cp311/
      markupsafe-2.1.5-cp311-cp311-android_aarch64.whl
  index.html
```

Published as a signed static site; `pip` is pointed at it with `--extra-index-url` and
`--only-binary=:all:` for native packages.
