# Python compatibility matrix

Filled in during Tasks 24–26 (plan v9). One row per package, per device. Never generalise from one device.

## Baseline

| Item | Value |
|---|---|
| CPython version | TBD — latest stable with an official python.org Android package (D-012) |
| Build | Official python.org `aarch64` Android build + LeoCode `python3` launcher (NDK r28), 16 KB aligned |
| Prefix | `<filesDir>/usr`, computed at runtime (user 0: `/data/user/0/dev.leocode/files/usr`) |
| libc | Bionic |
| pip | bundled |
| CA bundle | certifi, via `SSL_CERT_FILE` |
| venv | `python -m venv`, internal storage only |
| Compiler on device | **none** (MVP) |
| Native packages | Android wheels: LeoCode CI (cibuildwheel) and, if pip accepts them, PyPI Android wheels |

## Results

| Package | Type | D1 (A9) | D2 (A15) | Notes |
|---|---|---|---|---|
| requests | pure | | | |
| flask | pure | | | |
| rich | pure | | | |
| markupsafe | native | | | cibuildwheel wheel |
| ujson | native | | | cibuildwheel wheel |
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

The CI job (Task 24) produces:

```
index/
  android-aarch64/
    cp3XX/
      markupsafe-<ver>-cp3XX-cp3XX-android_<api>_arm64_v8a.whl
  index.html
```

Published as a signed static site; `pip` is pointed at it with `--extra-index-url` and
`--only-binary=:all:` for native packages. Exact wheel tag format follows cibuildwheel's Android
output.
