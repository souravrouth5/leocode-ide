# Release readiness — LeoCode

Every gate below is stated as something that can be checked, with its status as measured on
2026-11-22. Nothing here is estimated in time; the point is to make the remaining distance
auditable instead of a feeling. Update this file when a gate changes state.

**Summary: the product is not release-ready. The runtime/Python layer now runs on both phones
(Tasks 24–26) and the onboarding/diagnostics pass closed on both (Task 27, 2026-11-22), but release
engineering, Tasks 30–33 and the hardening work remain.** The Phase F API 28 gap closed on
2026-11-21: D1 passes T10–T14 and the extra Git/SSH rows, settling D-016.

## 1. Gate status at a glance

| # | Gate | Status | Evidence |
|---|---|---|---|
| 1 | Debug build produces an installable APK | **PASS** | `app-debug.apk`, 40,307,170 bytes, installs on D2 |
| 2 | Android unit tests | **PASS** | 425 tests, 0 failures, 1 skipped, `testDebugUnitTest` |
| 3 | Android lint | **PASS** (baseline) | `lintDebug`; 0 errors, 17 warnings (12 filtered by `lint-baseline.xml`) |
| 4 | Web unit tests | **PASS** | 300 tests in 43 files |
| 5 | Web typecheck / lint / build | **PASS** | `tsc --noEmit`, ESLint, Vite build |
| 6 | Bridge type drift | **PASS** | `generateBridgeTypes` + coverage test; CI drift step passed in run 44884113986 |
| 7 | 16 KB page alignment | **PASS** (static) | `scripts/check-elf-alignment.sh`, passed locally and in CI run 44884113986 |
| 8 | CI runs green on GitHub | **PASS** (two runs) | Runs [44884113986](https://github.com/souravrouth5/leocode-ide/actions/runs/44884113986) (dispatch, `7e62c71`) and [44888183932](https://github.com/souravrouth5/leocode-ide/actions/runs/44888183932) (PR, `53274ea`): `web` + `android` green, artifacts uploaded |
| 9 | Instrumented (on-device) tests | **ABSENT** | `android/app/src/androidTest` does not exist |
| 10 | Device matrix: D2 (Android 15) | **PARTIAL** | Phases B–F verified; Phase G Python (Task 26) verified 2026-11-22; Task 27 onboarding/diagnostics pending |
| 11 | Device matrix: D1 (Android 9 / API 28) | **PARTIAL** | Phases B–F verified; Phase F T10–T14 plus the extra Git/SSH rows passed on 2026-11-21 (D-016 settled); Phase G Python (Task 26) verified 2026-11-22; Task 27 pending |
| 12 | Device matrix: Android 10–14 | **NO HARDWARE** | D-014 accepts the gap; it cannot be closed by effort alone |
| 13 | Runtime/Python works on a device | **PARTIAL** | Tasks 24–26 verified on D1 and D2 (2026-11-22); Tasks 30–33 open |
| 14 | Release signing | **NOT DONE** | `signingConfig = signingConfigs.getByName("debug")` |
| 15 | R8 / shrinking | **NOT DONE** | `isMinifyEnabled = false`; no `proguard-rules.pro` |
| 16 | SBOM | **NOT DONE** | Task 28 |
| 17 | Onboarding + Diagnostics screens | **PASS** | Implemented and gated 2026-11-22 (Android 425 tests, web 300); D1 and D2 PASS (onboarding, trust gate, Copy, Share, redaction). Evidence: `docs/device-reports/20261122-task27-D1-D2.txt` |
| 18 | Accessibility audit | **NOT STARTED** | 27 of 55 web components use ARIA/roles; no a11y tests; Android has no a11y test coverage |
| 19 | Performance budgets | **NOT MEASURED** | No budget defined or enforced |
| 20 | Soak / long-run stability | **NOT DONE** | Every device PASS is a single run |
| 21 | Self-update | **NOT DONE** | Task 28 |
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

### 2.2 Release engineering does not exist

Gates 14–17 and 21 are all empty. A debug-signed, unminified APK published as a "nightly" is not a
release. R8 also matters functionally: the app ships JGit, MINA SSHD and Bouncy Castle, all of
which are reflection-heavy and will need keep rules — that work has not been started, and it is
the kind of work that surfaces new runtime failures when it is.

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

# gate 14-15 (currently expected to show debug signing and no minify)
grep -nE "signingConfig|isMinifyEnabled|shrinkResources" android/app/build.gradle.kts

# gate 9 (currently expected to be absent)
test -d android/app/src/androidTest && echo present || echo ABSENT

# gate 8
gh run list --branch v9-impl        # or the Actions tab on GitHub
```

Where a gate flips, update section 1 and note the commit that changed it.
