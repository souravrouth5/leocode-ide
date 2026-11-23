# Release readiness — LeoCode

Every gate below is stated as something that can be checked, with its status as measured on
2026-11-23. Nothing here is estimated in time; the point is to make the remaining distance
auditable instead of a feeling. Update this file when a gate changes state.

**Summary: the product is not release-ready. The runtime/Python layer runs on both phones
(Tasks 24–26), onboarding/diagnostics closed on both (Task 27, 2026-11-22), and release engineering
plus signed self-update closed in Task 28 (2026-11-23) — including real signed GitHub releases that
both phones updated from, anonymously — but Tasks 30–33, the accessibility/soak/performance gates,
and an owner-side offline keystore backup remain.** The Phase F API 28 gap closed on
2026-11-21: D1 passes T10–T14 and the extra Git/SSH rows, settling D-016.

## 1. Gate status at a glance

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | Debug build produces an installable APK | **PASS** | `app-debug.apk`, 40,307,170 bytes, installs on D2 |
| 2 | Android unit tests | **PASS** | 435 tests, 0 failures, 1 skipped, `testDebugUnitTest` |
| 3 | Android lint | **PASS** (baseline) | `lintDebug`; 0 errors, 17 warnings (12 filtered by `lint-baseline.xml`) |
| 4 | Web unit tests | **PASS** | 315 tests in 46 files |
| 5 | Web typecheck / lint / build | **PASS** | `tsc --noEmit`, ESLint, Vite build |
| 6 | Bridge type drift | **PASS** | `generateBridgeTypes` + coverage test; CI drift step passed in run 44884113986 |
| 7 | 16 KB page alignment | **PASS** (static) | `scripts/check-elf-alignment.sh`, passed locally and in CI run 44884113986 |
| 8 | CI runs green on GitHub | **PASS** (two runs) | Runs [44884113986](https://github.com/souravrouth5/leocode-ide/actions/runs/44884113986) (dispatch, `7e62c71`) and [44888183932](https://github.com/souravrouth5/leocode-ide/actions/runs/44888183932) (PR, `53274ea`): `web` + `android` green, artifacts uploaded |
| 9 | Instrumented (on-device) tests | **ABSENT** | `android/app/src/androidTest` does not exist |
| 10 | Device matrix: D2 (Android 15) | **PARTIAL** | Phases B–F verified; Phase G Python (Task 26) verified 2026-11-22; onboarding/diagnostics (Task 27) and signed self-update (Task 28) verified 2026-11-22/23 |
| 11 | Device matrix: D1 (Android 9 / API 28) | **PARTIAL** | Phases B–F verified; Phase F T10–T14 plus the extra Git/SSH rows passed on 2026-11-21 (D-016 settled); Phase G Python (Task 26) verified 2026-11-22; Task 27 and Task 28 verified 2026-11-22/23 |
| 12 | Device matrix: Android 10–14 | **NO HARDWARE** | D-014 accepts the gap; it cannot be closed by effort alone |
| 13 | Runtime/Python works on a device | **PARTIAL** | Tasks 24–26 verified on D1 and D2 (2026-11-22); Tasks 30–33 open |
| 14 | Release signing | **PASS** | Release keystore (RSA 4096, cert `2b294e12…bdaf`); `LEOCODE_REQUIRE_RELEASE_SIGNING=1` fails closed, the debug fallback needs an explicit opt-in. All five secrets (`RELEASE_STORE_BASE64`, `RELEASE_STORE_PASSWORD`, `RELEASE_KEY_ALIAS`, `RELEASE_KEY_PASSWORD`, `RELEASE_SIGNING_KEY`) are in the protected `release` environment, restricted to `main` + `v*`; rc1/rc4/rc5 built and published from it. Only an offline keystore backup stays owner-side |
| 15 | R8 / shrinking | **PASS** | `isMinifyEnabled` + `proguard-rules.pro` (JGit, SSHD, BouncyCastle, kotlinx-serialization, eddsa); rc3 passes `smoke.sh` on D1 (3 175 ms) and D2 (686 ms) |
| 16 | SBOM | **PASS** | `scripts/make-sbom.py` → CycloneDX 1.5 JSON (Maven + npm, dev deps dropped, deduplicated) published per release and nightly |
| 17 | Onboarding + Diagnostics screens | **PASS** | Implemented and gated 2026-11-22 (Android 425 tests, web 300); D1 and D2 PASS (onboarding, trust gate, Copy, Share, redaction). Evidence: `docs/device-reports/20261122-task27-D1-D2.txt` |
| 18 | Accessibility audit | **NOT STARTED** | 27 of 55 web components use ARIA/roles; no a11y tests; Android has no a11y test coverage |
| 19 | Performance budgets | **NOT MEASURED** | No budget defined or enforced |
| 20 | Soak / long-run stability | **NOT DONE** | Every device PASS is a single run |
| 21 | Self-update | **PASS** | Ed25519-signed manifest + APK signer/size/version check, then the system installer; D1 rc2→rc3→rc4→rc5 and D2 rc1→rc2→rc3→rc5 in-app (2026-11-22/23), the last hop on each fetched from the public `rc` channel with no token. Evidence: `docs/device-reports/20261123-task28-D1-D2.txt` |
| 22 | Root mode (Tasks 17–18) | **BLOCKED** | D2 has no `su`; needs a rooted device |
| 23 | Crash recovery / redaction | **PASS** | `CrashStore` + `Redactor` + `RecoveryActivity`; device demo on D1 and D2 2026-11-21 (renderer loss, escalation, forced crash, back order) |
| 24 | Secrets never reach the WebView | **PASS** | `PhaseFHandlerTest` asserts token stored-but-never-returned; `ssh-key-logcat.sh` clean on D2 |

## 2. What "production grade" actually requires here

### 2.1 The runtime layer is the product, and it has never run

LeoCode is sold as "an Android coding IDE with on-demand language runtimes". The IDE shell works.
The runtime — the thing that makes it an IDE rather than a text editor — has never executed in its
final form on a device.

- The Python prototype was **rejected**, with ten recorded defects (P-01…P-10: unsigned install,
  laptop-built launcher, unsafe extraction, non-atomic swap, staging shebangs, global
  `LD_LIBRARY_PATH`, no on-device run).
- Tasks 24–26 and 30–33 are all open: CI artifact, installer, integration/venv, `LanguageProvider`
  abstraction, run experience, REPL/packages, editor experience.
- **One thing is genuinely better than expected:** the shipped manifest
  (`assets/runtime/python.json`) points at a real CPython artifact —
  `python-3.14.10-aarch64-linux-android.tar.gz`. This was verified, not assumed: the URL returns
  200, the byte size matches (23,027,305), and `sha256sum` of the downloaded file equals the
  manifest's `423c80b9…569b`. So the packaging story has a real foundation; what is missing is the
  installer and everything around it.

This is the single largest block of remaining work, and it is mostly *unbuilt*, not *buggy*.

### 2.2 Release engineering exists, and the first signed build already found a device defect

Gates 14–16 and 21 closed in Task 28 (2026-11-23). A tag now produces a signed, R8-minified APK
with a signed manifest, `SHA256SUMS` and a CycloneDX SBOM, and the nightly is a signed prerelease on
its own channel instead of a debug APK. R8 needed the expected keep rules — JGit, MINA SSHD and
Bouncy Castle are reflection-heavy — and the first device run of the minified build surfaced a real
defect the debug build could not: on API 28 the updater's `getPackageArchiveInfo` call collected no
archive certificates, so the signer check rejected a legitimate download until rc2 added
`GET_SIGNATURES` and a `PackageInfo.signatures` fallback.

The pipeline is now proven end to end against the real service: `v0.1.0-rc1`, `v0.1.0-rc4` and
`v0.1.0-rc5` are public GitHub releases, their manifests verify against the committed Ed25519 key,
and both phones updated from the public `rc` channel (D1 rc4→rc5, D2 rc3→rc5) with anonymous
downloads. That exercise also forced two operational fixes: the release job's JVM was too small for
a 3.7 GB dev machine's `gradle.properties` (now separate gates with a CI-sized JVM, commit 778e697),
and a private repository answers release-asset requests with 404, which the app reports as
`E_OFFLINE` — hence the repository is public and the caveat is in `docs/RELEASING.md`.

What is still open here is operational, not code: back the keystore up offline and treat it as
permanent. The signer check compares current signers, so a rotated lineage would be rejected and
every user would have to reinstall by hand; the pinned expected certificate in CI has to move in the
same commit as any replacement keystore.

### 2.3 Verification depth is thin

This is the most under-appreciated gap, and this session is the evidence for it:

- Phase F was recorded as "merged" and looked complete. Built for the first time, it **did not
  compile**. Run for the first time, it produced **five defects**, three of them total
  showstoppers (keygen dead, no secret storable, every SSH connection failing).
- Every device result anywhere in this repo is a **single run per device** (Phase F now has a run on
  both D1 and D2). There are no repeats and no soak.
- There are **zero instrumented tests**. All Android testing is JVM-level with fakes, which is
  exactly the layer that cannot catch the class of bug above — every one of the five Phase F
  defects was invisible to JVM tests by construction.
- CI is green **twice** (runs 44884113986 and 44888183932). The workflow does not trigger on
  `v9-impl` pushes, so coverage depends on opening a PR or dispatching it manually. Two runs are
  still a smoke test, not a regression net.

## 3. Ordering that actually reduces risk

The instinct is to finish features. The evidence from this session says the higher-value move is to
increase the chance of *finding* problems before they ship.

1. **Keep CI running on every change** (gate 8). Two green runs are done; either add the Phase G
   branch to the `push` branches or keep every change flowing through a PR so the `pull_request`
   trigger covers it.
2. **Run the existing suite on D1** (gate 11). **Done for Phases B–F on 2026-11-21** — T10–T14 plus
   the extra Git/SSH rows pass, so D-016 is settled. The remaining D1 work is the Phase G runtime
   suite, which has not been built yet.
3. **Run the D2 suite twice consecutively** (gate 20, minimum). Establishes whether results are
   reproducible or the suite is flaky. This is the cheapest possible soak.
4. **Add instrumented tests for the device-only surfaces** (gate 9). The five Phase F defects show
   exactly where the blind spot is: Keystore, MINA/providers, and thread-affinity. Without this,
   every future phase repeats the same discovery cycle.
5. **Then build the runtime layer** (gate 13) — installer first (Task 25), because nothing else in
   Phase G can be tested until a runtime can be installed and launched on a device.
6. **Release engineering last** (gates 14–17, 21), since it depends on the final dependency set.

## 4. Things that cannot be fixed by more work

- **Android 10–14 have no hardware** (D-014). Those API levels ship unverified. Whether that is
  acceptable is a product decision, not an engineering one.
- **Root mode is blocked** without a rooted device (D2 is a LineageOS *user* build with no `su`).
- **TLS for token auth is unproven on a device.** The token row was closed as a unit test; live
  HTTPS with a real token was never exercised.
- **`targetSdk` stays at 28** deliberately (D-002) to keep `execve()` working for downloaded
  binaries. That choice will conflict with Play Store requirements and future Android releases;
  it is a standing product risk, not a bug to fix.

## 5. How to re-check this document

```bash
# gates 2-7
cd android && ./gradlew testDebugUnitTest lintDebug assembleDebug
cd ../web && npm run typecheck && npm run lint && npm test && npm run build
cd .. && bash scripts/check-elf-alignment.sh

# gate 14-16 (release signing, R8, SBOM)
grep -nE "signingConfig|isMinifyEnabled|shrinkResources" android/app/build.gradle.kts
grep -n "keep" android/app/proguard-rules.pro
scripts/tests/run-release-script-tests.sh        # tag math, manifest, signing, SBOM

# gate 21 (signed self-update)
grep -n "UPDATE_MANIFEST_URL\|updateUrl" android/app/build.gradle.kts

# gate 9 (currently expected to be absent)
test -d android/app/src/androidTest && echo present || echo ABSENT

# gate 8
gh run list --branch v9-impl        # or the Actions tab on GitHub
```

Where a gate flips, update section 1 and note the commit that changed it.
