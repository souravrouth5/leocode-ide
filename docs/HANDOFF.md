# Handoff — LeoCode state after Task 26 (updated 2026-11-21)

Written for whoever picks this up next. It records what is done, what is open, how to reproduce the
verification, and the traps that cost time. The task tracker (`PROGRESS.md`) and the device reports
under `docs/device-reports/` remain the source of truth; this file is the orientation layer.

**Current phase:** Phase G (Python, D-017). Tasks 24 and 25 are done; Task 26's implementation and
unit gates are done, and only its device rows remain.

## Where the work is

| Item | State |
|---|---|
| Branch | `feat/phase-g`, pushed to `origin` (do not merge without asking; the owner merges) |
| Task 24 | CI and packaging complete; run [44915640602](https://github.com/souravrouth5/leocode-ide/actions/runs/44915640602) green. The signed release is blocked on the protected `python-runtime` environment and `RUNTIME_SIGNING_KEY` (the current PAT gets 403 on environment APIs). |
| Task 25 | **Done and device-verified on D1 and D2.** Raw evidence: [`device-reports/20261121-task25-D1-D2.txt`](device-reports/20261121-task25-D1-D2.txt). |
| Task 26 | **Implementation complete, unit gates green, device rows in progress.** Commit `0a3fc84`. D2 T15 reached venv/aliases/pip/requirements PASS; the wheel row failed on an invalid pushed filename. D1 has not run T15. |
| Working tree | Clean after the docs commit |
| Gates | Android 417 unit tests / 0 failures / 1 skipped, `lintDebug`, `assembleDebug`; web 288 tests, typecheck, lint, build |
| Devices | D1 `192.168.29.26:5555` (Redmi Note 7S, Android 9 / API 28); D2 `e76846f` (POCO F1, Android 15 / API 35) |

## What Task 26 added

| Layer | Change |
|---|---|
| Trust | `core/TrustStore.kt`: per-project `script`, `pip`, `venv`, `git-hooks` grants tied to a SHA-256 fingerprint of the files they cover. Editing the script, `requirements.txt`, Git hooks, the project path or the runtime marker invalidates the grant. A corrupt index trusts nothing rather than failing every run. |
| Python | `core/PythonProject.kt`: creates/removes `<project>/.venv` with the bundled runtime, runs pip/scripts with `VIRTUAL_ENV` and the venv first on `PATH`, and records the installed `requirements.txt` hash in `.venv/.leocode-requirements`. Aliases `python -> python3`, `pip -> pip3` are created at install time and on startup for existing runtimes. |
| Bridge | `TrustHandler.kt`, `PythonHandler.kt`, DTOs in `Contract.kt`: `trust.check`/`grant`/`revoke`; `python.status`/`venv.create`/`venv.remove`/`requirements.install`. The install streams `python.install` and replies when pip exits. `proc.run` accepts an allowlisted `env`. |
| Web | `features/python/pythonStore.ts` + `PythonProjectPanel.tsx`; `runStore` resolves the venv interpreter, asks for trust, and offers to install missing requirements before a `.py` run. Runtimes view shows the active project's runtime, venv, requirements and aliases. |
| Harness | `PythonHarness.kt` + T15: venv, aliases, pip, requirements, optional wheel, then a script that imports `requests`/`markupsafe` and fetches `https://example.com`. |

## Device verification: what is proven, and what is not

**Task 26 raw compatibility probes (both phones, 2026-11-21) — PASS.** Raw logs:
[`device-reports/20261121-task26-D1-D2.txt`](device-reports/20261121-task26-D1-D2.txt).

- venv create/activate; `python -> python3 -> usr/bin/python3`
- `requests` 2.34.2 from PyPI fetches `https://example.com` (`200`, 577 bytes)
- `markupsafe` 3.0.2 from the LeoCode Android wheel imports `_speedups`
- `pygments` console-script shebang points at the venv python
- `requirements.txt` installs; peak RSS 8 548 KB (D1) / 11 064 KB (D2)
- pip accepts PyPI Android wheels (`charset-normalizer` 3.5.2, `cp314-cp314-android_24_arm64_v8a`)

**T15 through the production harness — partial.** D2 (2026-11-21 23:16) passed venv creation,
`pyvenv.cfg`, aliases, pip 26.2.2 and the `requests` requirements install. The markupsafe row failed
with `Invalid wheel filename (wrong number of parts): 't15-markupsafe'` because the wheel was pushed
under a short name; pip requires `name-version-...whl`. Rename it on the device (see below) and
rerun. **D1 has not run T15 yet.** Do not infer either device's result from the other.

The app-UI demo (create venv, install requirements, run a script with the trust prompt) has not been
recorded on either phone yet.

## Reproducing the T15 run

```bash
cd android && ./gradlew :app:assembleDebug
APK=app/build/outputs/apk/debug/app-debug.apk
adb -s <serial> install -r -g "$APK"

# The LAN has no direct internet. The host runs an authenticated proxy on 8080
# (see the summary of /tmp/opencode/local-proxy.py) and exposes it on 18080:
python3 /tmp/opencode/local-proxy.py 18080 &
adb -s <serial> reverse tcp:18080 tcp:18080

# Copy the markupsafe wheel into app storage under a VALID wheel name.
adb -s <serial> push \
  /tmp/opencode/wheelout/markupsafe-3.0.2-cp314-cp314-android_24_arm64_v8a.whl \
  /sdcard/Download/t15-markupsafe.whl
adb -s <serial> shell run-as dev.leocode mkdir -p files/tmp
adb -s <serial> shell run-as dev.leocode cp /sdcard/Download/t15-markupsafe.whl \
  files/tmp/markupsafe-3.0.2-cp314-cp314-android_24_arm64_v8a.whl

adb -s <serial> logcat -c
adb -s <serial> shell am start -n dev.leocode/.HarnessActivity --es run T15 \
  --es proxy http://127.0.0.1:18080 \
  --es wheel /data/user/0/dev.leocode/files/tmp/markupsafe-3.0.2-cp314-cp314-android_24_arm64_v8a.whl
adb -s <serial> logcat -d -s LeoCodeHarness:I
```

A PASS ends with `PASS venv + requests + markupsafe + fetch` and `fetch 200`. `files/tmp/t15-project`
is deleted and recreated on every run. Clean up afterwards: the project directory, the copied wheel,
`/sdcard/Download/t15-markupsafe.whl`, and `adb reverse --remove tcp:18080`.

If `run-as ... cp /sdcard/...` is denied (D2 on Android 15), stream it instead:

```bash
adb -s <serial> shell run-as dev.leocode dd \
  of=files/tmp/markupsafe-3.0.2-cp314-cp314-android_24_arm64_v8a.whl \
  < /tmp/opencode/wheelout/markupsafe-3.0.2-cp314-cp314-android_24_arm64_v8a.whl
```

## What to do next

1. **Finish Task 26 device rows.** Rerun T15 on D2 with the valid wheel name, then run the same T15
   on D1. Record both in `PROGRESS.md`, `docs/test-matrix.md` and the compatibility notes. Then run
   the app-UI demo on both phones (Runtimes → create environment → install requirements → Run a
   `.py` file → accept the trust prompt) and capture evidence.
2. **Fix the compatibility doc's last paragraph.** `docs/compatibility.md` still says the wheel
   install/import row is pending; the probes above proved it. Replace that sentence with the
   measured result.
3. **Task 24 release (owner action).** Create the protected `python-runtime` environment, upload
   `RUNTIME_SIGNING_KEY`, and dispatch CI so the release job publishes the tarball, manifest,
   signature, wheel and `SHA256SUMS`.
4. **Ask before starting Task 27.** Task 26 was explicitly scoped and approved; do not roll into the
   next Phase G task without confirmation.

## Traps that cost time (read before debugging a "network" failure)

1. **Direct internet is blocked on this LAN.** Use the host proxy on `18080` with `adb reverse`.
   `example.com` through `requests` works; `pypi.org/simple/` and `files.pythonhosted.org` are flaky
   and sometimes reset. Restart the proxy if `curl -x http://127.0.0.1:18080 https://example.com`
   stops returning `200`.
2. **A sleeping screen or an active VPN blocks app-UID networking.** Keep the device awake
   (`svc power stayon true`) and turn the VPN off. `adb shell` is exempt, so it looks like an app bug.
3. **pip validates wheel filenames.** A wheel copied as `t15-markupsafe.whl` is rejected before any
   install. Keep `name-version-python-abi-platform.whl`.
4. **D1's main logcat buffer is only 256 KB.** Run `adb logcat -G 16M` before a long sequence.
5. **CI does not run on a branch push.** `ci.yml` triggers on `main` pushes, PRs and
   `workflow_dispatch`; dispatch it by hand for `feat/phase-g`.
6. **The GitHub PAT is still plaintext in `.git/config`.** Rotate it and move it to a credential
   helper; do not print remotes in shared output.

## Honest caveats

- Every PASS is a single-run measurement per device; nothing here is a soak test.
- The Task 26 probes used `run-as` shell scripts; T15 is the production-harness equivalent and has
  only partially run on D2.
- `markupsafe` comes from the LeoCode wheel, not PyPI: PyPI has no Android wheel for 3.0.2 and pip
  correctly refuses it there.
- The signed Task 24 release has never run; only the unsigned CI path is proven.
