# Task 24 verification — CI Python artifact and Android wheels

**Date:** 2026-11-21 · **Branch:** `feat/phase-g` · **Commit:** `cae3e0f` ·
**CI run:** [44915640602](https://github.com/souravrouth5/leocode-ide/actions/runs/44915640602)

## What changed

| Piece | Purpose |
|---|---|
| `scripts/check-runtime-artifact.py` | Verifies the pinned python.org tarball: https URL, sha256, size, safe tar entries (no absolute paths, `..`, devices, FIFOs, setuid/setgid, escaping links), layout (`libpython3.14.so`, stdlib, `Python.h`), pruned install size against `install.installedSize`, and 16 KB alignment of every ELF. |
| `runtime-packaging/build_android_wheel.py` | Compiles a pinned sdist with the NDK against the runtime's headers/libpython and assembles the wheel (`cp314-cp314-android_24_arm64_v8a`), including a correct `RECORD`. |
| `runtime-packaging/build_wheel_index.py` | Emits a static PEP 503 index for the built wheels. |
| `runtime-packaging/wheels/markupsafe.json` | Pins markupsafe 3.0.2 sdist URL/sha256 and the extension recipe. |
| `docs/keys/manifest-public.pem` | Public half of the runtime signing key; matches `RuntimeKeys.PYTHON` and fingerprint `3552be70…c95e`. |
| `.github/workflows/ci.yml` | Replaces the `python-runtime` stub with a real verification/build job and adds the gated signed-release job. |
| `scripts/build-python.sh` | Deleted; the official artifact is no longer repackaged (D-012). |

## CI result

Run `44915640602` on `feat/phase-g` (`workflow_dispatch`) completed **success**.

| Job | Result |
|---|---|
| Web (lint + tests + build) | success |
| Python runtime artifact | success |
| Python runtime release (signed) | success — publish skipped, no secret |
| Android (tests + lint + assemble + 16 KB) | success |
| Nightly APK release | skipped (not a `main` push) |

### Python runtime artifact job

```
sha256  423c80b957330cf0ebb92b9b20f2294c292144a441bdb0ceb8c69d14928e569b
bytes   23027305
tar     3218 entries, no unsafe paths/links
layout  prefix/  libpython=libpython3.14.so  stdlib=python3.14  headers=python3.14
size    raw 2958 files / 81309952 bytes; installed 859 files / 42190285 bytes
reserve 42190285 <= 47185920 (manifest installedSize)
16 KB check: PASSED (80 ELF file(s))
PASS runtime artifact
Signature Verified Successfully
wheel runtime-packaging/out/wheels/markupsafe-3.0.2-cp314-cp314-android_24_arm64_v8a.whl (11404 bytes)
sha256 2fb50c4677467c797973bbd81a2885facfe8bd96ee40057aff0c0be4e7b6ee32
16 KB check: PASSED (1 ELF file(s))
index runtime-packaging/out/index: 1 wheel(s), 1 project(s)
```

The wheel hash matches the local rebuild byte-for-byte, so the recipe is
reproducible. pip accepts the tag on the official runtime; a local
`pip install --platform android_24_arm64_v8a --python-version 3.14 --abi cp314`
installed the wheel and placed `_speedups.cpython-314-aarch64-linux-android.so`
under `markupsafe/`.

### Signed release job

```
##[notice]RUNTIME_SIGNING_KEY is not set; skipping the signed release.
```

The job still verifies the artifact and builds `SHA256SUMS`. Publishing needs
the protected `python-runtime` environment secret; the current PAT cannot create
environments (403), so that remains an owner action. When the secret exists the
job signs the manifest, verifies it against `docs/keys/manifest-public.pem`, and
publishes the tarball, manifest, signature, wheel and `SHA256SUMS` to the
`python-runtime` prerelease.

## Not covered yet

- On-device install/import of the `markupsafe` wheel and the PyPI-wheel probe
  are Task 26 rows (`docs/test-matrix.md`).
- The published release page is not visible until the secret is uploaded.
