# Handoff — LeoCode state after Task 28 (updated 2026-11-23)

Written for whoever picks this up next. It records what is done, what is open, how to reproduce the
verification, and the traps that cost time. The task tracker (`PROGRESS.md`) and the device reports
under `docs/device-reports/` remain the source of truth; this file is the orientation layer.

**Current phase:** Phase G (Python, D-017). Tasks 24–28 are done, including the device rows on D1
and D2. The next task is 29 (hardening, soak, accessibility, performance budgets, full matrix,
0.1 go/no-go), which needs an owner decision before it starts.

## Where the work is

| Item | State |
|---|---|
| Branch | `feat/phase-g`, pushed to `origin` (do not merge without asking; the owner merges) |
| Task 24 | CI and packaging complete; run [44915640602](https://github.com/souravrouth5/leocode-ide/actions/runs/44915640602) green. The signed release is blocked on the protected `python-runtime` environment and `RUNTIME_SIGNING_KEY` (the current PAT gets 403 on environment APIs). |
| Task 25 | **Done and device-verified on D1 and D2.** Raw evidence: [`device-reports/20261121-task25-D1-D2.txt`](device-reports/20261121-task25-D1-D2.txt). |
| Task 26 | **Done.** Commit `0a3fc84` plus the `ProcHandler` cwd fix. Both D1 and D2 passed T15 and the full app-UI flow on 2026-11-22. |
| Task 27 | **Done and device-verified on D1 and D2 (2026-11-22).** Three first-run screens and Settings › About › Diagnostics; D1 (Android 9) and D2 (Android 15) both passed onboarding, the non-skippable trust gate, relaunch, diagnostics, Copy, Share and redaction. |
| Task 28 | **Done and device-verified on D1 and D2 (2026-11-22/23).** Signed R8 releases from a tag, CycloneDX SBOM, signed nightly prerelease on its own channel, and in-app self-update (signed manifest + signer check + system installer). The repository is public and the five `release` secrets are configured, so `v0.1.0-rc1`, `v0.1.0-rc4` and `v0.1.0-rc5` are real GitHub releases that download anonymously. D2 updated rc1→rc2→rc3→rc5 and D1 updated rc2→rc3→rc4→rc5 in-app; the final rc4→rc5 (D1) and rc3→rc5 (D2) hops came from the public `rc` channel with no local mirror for the APK. The rc1 run exposed an API 28 signer-collection defect that rc2 fixed. Raw evidence: [`device-reports/20261123-task28-D1-D2.txt`](device-reports/20261123-task28-D1-D2.txt). |
| Working tree | Clean for Task 28 (committed on top of `778e697`) |
| Gates | Android 435 unit tests / 0 failures / 1 skipped, `lintDebug`; web 315 tests, typecheck, lint, build; `scripts/tests/run-release-script-tests.sh` 17/17; CI runs [45139842778](https://github.com/souravrouth5/leocode-ide/actions/runs/45139842778) (`3e342eb`) and [45160907976](https://github.com/souravrouth5/leocode-ide/actions/runs/45160907976) (`778e697`, all jobs incl. signed release) green |
| Devices | D1 `192.168.29.26:5555` (Redmi Note 7S, Android 9 / API 28); D2 `10.8.0.90:38961` wireless (POCO F1, Android 15 / API 35; the Wi-Fi serial and port change with DHCP, and USB `e76846f` dropped out mid-session) |

## What Task 26 added

| Layer | Change |
|---|---|
| Trust | `core/TrustStore.kt`: per-project `script`, `pip`, `venv`, `git-hooks` grants tied to a SHA-256 fingerprint of the files they cover. Editing the script, `requirements.txt`, Git hooks, the project path or the runtime marker invalidates the grant. A corrupt index trusts nothing rather than failing every run. |
| Python | `core/PythonProject.kt`: creates/removes `<project>/.venv` with the bundled runtime, runs pip/scripts with `VIRTUAL_ENV` and the venv first on `PATH`, and records the installed `requirements.txt` hash in `.venv/.leocode-requirements`. Aliases `python -> python3`, `pip -> pip3` are created at install time and on startup for existing runtimes. |
| Bridge | `TrustHandler.kt`, `PythonHandler.kt`, DTOs in `Contract.kt`: `trust.check`/`grant`/`revoke`; `python.status`/`venv.create`/`venv.remove`/`requirements.install`. The install streams `python.install` and replies when pip exits. `proc.run` accepts an allowlisted `env`. |
| Web | `features/python/pythonStore.ts` + `PythonProjectPanel.tsx`; `runStore` resolves the venv interpreter, asks for trust, and offers to install missing requirements before a `.py` run. Runtimes view shows the active project's runtime, venv, requirements and aliases. |
| Harness | `PythonHarness.kt` + T15: venv, aliases, pip, requirements, optional wheel, then a script that imports `requests`/`markupsafe` and fetches `https://example.com`. |

## What Task 27 added

| Layer | Change |
|---|---|
| Onboarding | `features/onboarding/Onboarding.tsx`: three mandatory screens (app-private storage; battery/MIUI/phantom-process killer; scripts/packages trust warning). `localStorage["leocode.onboarding.v1"]` marks the install as seen. The trust screen needs an explicit checkbox, back walks the steps, and there is no close/backdrop/Escape path. Settings → About can replay it. |
| Diagnostics | `core/Diagnostics.kt` formats a plain-text report (app/build, device, Android/SDK/patch, ABIs, WebView, page size, root, storage, heap, workspace, runtimes, last crash) and passes the whole thing through `Redactor`. `app.diagnostics` returns `{ report }`; `CrashStore.peek` reads the pending crash without consuming it. |
| Copy / Share | `features/diagnostics/DiagnosticsSheet.tsx` appends the web recent-error ring and redacts again. Copy uses the clipboard; Share calls `app.share`, which redacts once more and opens the system chooser, with `navigator.share`/Copy as fallbacks. |
| Errors | `errorsStore.recent` keeps the newest 20 reports with timestamps for the diagnostics screen. |
| Contract | `DiagnosticsReply`, `ShareRequest`, `ShareReply`; generator seeds updated and `types.gen.ts` regenerated. |

## What Task 28 added

| Layer | Change |
|---|---|
| Keys | Release keystore (`~/.config/leocode/release.jks`, RSA 4096, alias `leocode`, cert SHA-256 `2b294e12…bdaf`) and a release-manifest Ed25519 key (`~/.config/leocode/release-signing.pem`). Only the public half is committed: `docs/keys/release-manifest-public.pem` (SPKI fingerprint `87e1a3b8…4142`). Setup and backup steps: [`RELEASING.md`](RELEASING.md). |
| Build | `android/app/build.gradle.kts`: `versionName`/`versionCode` from `LEOCODE_VERSION_*` (validated), R8 + `proguard-rules.pro` keeps (JGit, SSHD, BouncyCastle, kotlinx-serialization, `net.i2p.crypto.eddsa`), `BuildConfig.UPDATE_MANIFEST_URL`, and `exportReleaseDependencies` for the SBOM. `LEOCODE_REQUIRE_RELEASE_SIGNING=1` fails closed; debug signing needs `LEOCODE_ALLOW_DEBUG_SIGNING=1`. |
| Update | `core/ReleaseManifest.kt` + `core/UpdateChecker.kt` fetch `release.json` and `release.json.sig`, verify the Ed25519 signature against `core/ReleaseKeys.kt` and bound-check the fields. `core/UpdateInstaller.kt` downloads (resume, disk space, cancel), verifies size/SHA-256/package/`versionCode`, compares the archive signer set with the installed app, and opens the system installer through a `FileProvider` (`${applicationId}.updates`). `bridge/UpdateHandler.kt` exposes `update.check`/`update.install`/`update.cancel` and maps failures to the existing error codes. |
| Web | `features/update/updateStore.ts`, `UpdatesCard.tsx`, `updateCopy.ts`; the Settings › About **Updates** card shows the installed version, the offered build with notes/size, "Last checked", and check/download/cancel states. |
| Scripts | `scripts/version-from-tag.sh` (canonical `vX.Y.Z[-rcN]` → code, rejects leading zeros and out-of-range components), `build-release.sh` (local signed build), `make-release-manifest.py`, `sign-release.sh`, `make-sbom.py` (CycloneDX 1.5 from the Gradle dependency report + `package-lock.json`), and `scripts/tests/run-release-script-tests.sh` (17 cases, run in CI's web job). |
| CI | `.github/workflows/ci.yml`: tag `v*` and a daily 03:00 UTC nightly (+ manual dispatch limited to `main`/tags) build inside the protected `release` environment with step-scoped secrets, verify the APK certificate and version against the tag, sign the manifest, write `SHA256SUMS` + SBOM, and publish. `-rc` tags are prereleases with a per-tag manifest URL; the nightly uses fixed asset names, a code band above every tag code, and a moving `nightly` tag. |

## Device verification: what is proven, and what is not

**Task 26 raw compatibility probes (both phones, 2026-11-21) — PASS.** Raw logs:
[`device-reports/20261121-task26-D1-D2.txt`](device-reports/20261121-task26-D1-D2.txt).

- venv create/activate; `python -> python3 -> usr/bin/python3`
- `requests` 2.34.2 from PyPI fetches `https://example.com` (`200`, 577 bytes)
- `markupsafe` 3.0.2 from the LeoCode Android wheel imports `_speedups`
- `pygments` console-script shebang points at the venv python
- `requirements.txt` installs; peak RSS 8 548 KB (D1) / 11 064 KB (D2)
- pip accepts PyPI Android wheels (`charset-normalizer` 3.5.2, `cp314-cp314-android_24_arm64_v8a`)

**D2 — T15 and app UI PASS (2026-11-22).** T15 through the production harness passed venv,
`pyvenv.cfg`, aliases, pip 26.2.2, the `requests` requirements install, the markupsafe Android wheel
and the script (`python 3.14.10`, `requests 2.34.2`, `markupsafe &lt;b&gt;`, `fetch 200 577`). The
app UI also passed: the Runtimes panel, venv creation with trust, pip with trust and a streamed log,
Run through the project venv (`EXIT 0`), no prompt on a second Run, and a fresh requirements/trust
prompt after editing `requirements.txt`. Raw report:
[`device-reports/20261122-task26-D2-ui.txt`](device-reports/20261122-task26-D2-ui.txt).

**D1 — T15 and app UI PASS (2026-11-22).** D1 (Android 9 / API 28) produced the same T15 result as
D2: venv, `pyvenv.cfg`, aliases, pip 26.2.2, the `requests` requirements install, the markupsafe
Android wheel and the script (`python 3.14.10`, `requests 2.34.2`, `markupsafe &lt;b&gt;`,
`fetch 200 577`). The app UI also passed: Runtimes panel, venv creation with trust, pip with trust
and a streamed log, Run through the project venv (`EXIT 0`), no prompt on a second Run, and a fresh
requirements/pip trust prompt after editing `requirements.txt`. Raw report:
[`device-reports/20261122-task26-D1-ui.txt`](device-reports/20261122-task26-D1-ui.txt).

**Task 27 device rows — D1 and D2 PASS (2026-11-22).** Both phones walked all three onboarding
screens, could not dismiss them with back, required the acknowledgement, and did not show them again
after a force-stop/relaunch. Diagnostics listed the required fields; Copy handed the exact visible
text to the clipboard; Share opened the system chooser (`ChooserActivity` on Android 9,
`ChooserActivityLauncher` on Android 15); injected `/data/... token=...` errors appeared as
`<path> token=<redacted>`, and the report contained no `/data/` or `/storage/`. Evidence:
[`device-reports/20261122-task27-D1-D2.txt`](device-reports/20261122-task27-D1-D2.txt) with the
screenshots beside it. Note for the next run: D2's unattended first launch had the onboarding marker
already set with no harness input; `pm clear` restored the first-run state, and an untouched second
launch stayed on the onboarding, so the clean path is the one recorded. Do not infer one phone's
result from the other.

**Defect this run found:** `proc.run` resolved a relative `cwd` against
`workspace.defaultWorkspace`, so the first Run in a non-default project looked for the script under
`workspaces/default`. `ProcHandler` now takes the active-root supplier, like the trust/python
handlers, and `ProcHandlerTest` covers it.

**Task 28 device rows — D1 and D2 PASS (2026-11-22/23).** Both phones installed the R8 release build
over the previous build and cold-started (rc1: D1 6 936 ms, D2 516 ms; rc3: D1 3 175 ms, D2 686 ms).
D2 updated rc1→rc2 and rc2→rc3 entirely in-app: the About card showed the installed build, "Check for
updates" verified the signed manifest and offered the next rc, "Download and install" opened the
system installer, and after Play Protect the app reported `versionCode` 1003. D1 did the same for
rc2→rc3, but its Android 9 build showed an "Open with" chooser (several apps handle APKs) and Play
Protect blocked the first attempt until "More details" → "Install anyway"; both are documented in the
evidence file. Evidence:
[`device-reports/20261123-task28-D1-D2.txt`](device-reports/20261123-task28-D1-D2.txt) with the
screenshots beside it.

**Public channel — the same flow against real GitHub releases (2026-11-23).** Once the repository
was public, rc1, rc4 and rc5 were published from tags and downloaded anonymously from
`releases/download/rc/…`; no token, no mirror for the APK. D1 went rc4→rc5 and D2 went rc3→rc5,
both over HTTPS from GitHub, ending on `versionCode` 1005 with a follow-up "up to date" check. The
first hop on each phone used a local mirror for the *manifest* only, because the installed rc3 build
had `LEOCODE_UPDATE_URL=file:///…` baked in; the APK inside that manifest was the public GitHub URL,
which is what proves the channel itself works. Three channels exist and are documented in
[`RELEASING.md`](RELEASING.md): stable (`releases/latest/download/release.json`, empty until a stable
`v0.1.0` lands), rc (`releases/download/rc/release.json`, a moving tag with fixed asset names), and
nightly (`releases/download/nightly/release.json`). A private repository serves release assets only
to authenticated clients, so the installed app saw HTTP 404 → `E_OFFLINE`; that is why the repo is
public and why the caveat is recorded.

**Defect this run found:** on API 28 `PackageManager.getPackageArchiveInfo()` collects archive
certificates only when `GET_SIGNATURES` is in the flag mask. rc1 asked for `GET_SIGNING_CERTIFICATES`
alone, so the archive signer set came back empty and the updater rejected its own download with
`E_INTEGRITY`. rc2 requests both flags and falls back to `PackageInfo.signatures`;
`UpdateInstallerFlagsTest` pins the mask. This is exactly the class of defect a debug build cannot
show, because the debug build never exercised the updater against a release-signed archive.

**Known difference, not fixed:** D1's WebView (Chrome 80) logs
`Uncaught TypeError: Cannot read properties of null (reading 'style')` twice at startup. It predates
Task 28 (it is in the rc1 smoke log too), does not block the UI, and does not appear on D2. A future
task can chase it with the WebView console attached.

## Reproducing the Task 28 release + update demo

```bash
# 1. Build a signed release from a tag-shaped version (owner keys under ~/.config/leocode/).
scripts/build-release.sh 0.1.0-rc3 1003 file:///sdcard/Download/leocode-update/release.json
#    -> dist/release/leocode-1003.apk

# 2. Sign the manifest and push the three files to the phone's local mirror.
python3 scripts/make-release-manifest.py --apk dist/release/leocode-1003.apk \
  --version-name 0.1.0-rc3 --version-code 1003 \
  --url file:///sdcard/Download/leocode-update/leocode-1003.apk \
  --notes "demo" --out dist/release/release.json
scripts/sign-release.sh dist/release/release.json
adb -s <serial> push dist/release/leocode-1003.apk dist/release/release.json \
  dist/release/release.json.sig /sdcard/Download/leocode-update/

# 3. Allow installs and storage, then drive Settings › About › Updates.
adb -s <serial> shell appops set dev.leocode REQUEST_INSTALL_PACKAGES allow
adb -s <serial> shell pm grant dev.leocode android.permission.READ_EXTERNAL_STORAGE

# 4. Prove the build: install and cold-start.
scripts/smoke.sh <serial> dist/release/leocode-1003.apk
```

The release URL is compiled in (`BuildConfig.UPDATE_MANIFEST_URL`, default
`https://github.com/souravrouth5/leocode-ide/releases/latest/download/release.json`) and can be
overridden with `LEOCODE_UPDATE_URL` or `-Pleocode.updateUrl` for a demo build. A tag release uses
`.../releases/download/<tag>/release.json` for `-rc` tags, because `releases/latest` never points at
a prerelease.

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

1. **Back up the release keys (owner action).** The five `release` environment secrets are
   configured and restricted to `main` + `v*`, and rc1/rc4/rc5 published from them. What is still
   owner-only is an offline backup of `~/.config/leocode/release.jks`, `release.properties` and
   `release-signing.pem`, plus a rotation decision. The updater compares the archive's current
   signers with the installed app's, so replacing the keystore would reject updates for everyone
   until they reinstall by hand; treat the keystore as permanent. The pinned expected certificate in
   the CI release job (`2b294e12…bdaf`) must be updated in the same commit as any new keystore.
2. **Task 24 release (owner action).** Create the protected `python-runtime` environment, upload
   `RUNTIME_SIGNING_KEY`, and dispatch CI so the release job publishes the tarball, manifest,
   signature, wheel and `SHA256SUMS`.
3. **Ask before starting Task 29.** Task 28 was explicitly scoped and approved; do not roll into the
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
