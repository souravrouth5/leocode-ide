# Phase A analysis report

**Date:** 2026-11-11 · **Branch:** `v9-impl` · **Reviewer:** orchestrator (Claude), read-only sub-agents for file reading, device checks run by the orchestrator
**Scope:** Phase A of [plan v9](../LeoCode_Implementation_Plan_v9.md) (Tasks 1–3) plus everything else committed on `v9-impl` so far
**Audience:** the next AI model (or person) who will fix these findings before Phase B starts. Everything needed is in this file; open the plan only for the task text.

---

## 1. Verdict

**Phase A is not ready to close.** The code builds, tests pass, and both phones run the harness. What is missing is trustworthy evidence and a few script defects. None of the findings needs more than a day of work.

| Gate | State |
|---|---|
| Web checks (`typecheck`, `lint`, `test`, `build`) | **PASS** |
| Android checks (`testDebugUnitTest`, `lintDebug`, `assembleDebug`) | **PASS** (full tree, 2 min 14 s) |
| 16 KB ELF check on the built APK | **PASS** (`libleocodepty.so` LOAD align `0x4000`, `zipalign -P 16` ok) |
| Harness T1–T7 on D1 (Android 9) and D2 (Android 15) | **PASS** on both (logs committed, §5) |
| CI has run on GitHub | **NO**: the branch was never pushed (owner chose to stay local) |
| Scripts match the plan and decisions | **NO**: see A-01 to A-05 |
| Docs claims backed by raw evidence | **PARTIAL**: see A-06 to A-10 |
| Root mode testable | **NO**: D2 is not rooted (owner will root it before Phase E) |

**Recommended next steps, in order:** fix A-01 → A-10 (Section 3), then re-run the exit checklist (Section 7), then start Phase B Task 4. Do not start Python or any Phase B work before the checklist is green.

---

## 2. Context a fixer needs

- **App:** LeoCode, an Android coding IDE. Kotlin host in `android/`, React + TypeScript + Vite UI in `web/`, helper scripts in `scripts/`, docs in `docs/`. Package `dev.leocode`, targetSdk 28 on purpose (D-002), minSdk 28.
- **Devices** (both connected over `adb`):
  - **D1** Redmi Note 7S, Android 9, unrooted, Wi-Fi ADB `192.168.29.26:5555`.
  - **D2** POCO F1 (`beryllium`), LineageOS build, Android 15, USB serial `e76846f`. **Not rooted**: no `su`, no Magisk/KernelSU/APatch package (`docs/device-reports/20261111-phaseA-verification.txt`).
  - Both report `PAGE_SIZE=4096`. No device exercises 16 KB pages at runtime.
  - Always pass `-s <serial>`; two devices are attached.
- **JDK:** the repo no longer contains a JDK path. This laptop has `org.gradle.java.home=/home/sourav/jdk17` in `~/.gradle/gradle.properties`.
- **Commands used for verification:**
  ```bash
  cd web && npm ci && npm run typecheck && npm run lint && npm test && npm run build
  cd android && export ANDROID_HOME=$HOME/Android/Sdk && ./gradlew --no-daemon testDebugUnitTest lintDebug assembleDebug
  bash scripts/check-elf-alignment.sh android/app/build/outputs/apk/debug/app-debug.apk
  ```
- **Commits on `v9-impl` after `main`:** `b9b029a` (Tasks 2+3), `bfa1a56` (Runtime tab honesty fix), `1a279a2` (Python installer prototype, committed as-is on request). The plan and report updates are in the commit after those.
- **Decisions to respect:** D-002 (do **not** raise targetSdk or "fix" the disabled `ExpiredTargetSdkVersion` lint rule), D-011 (root is opt-in and never prompts at startup), D-013 (diagnostics stay local), D-017 (Python is the primary language).

---

## 3. Findings to fix in Phase A

Severity: **High** = blocks closing Phase A or breaks a decision. **Medium** = wrong or misleading, cheap to fix. **Low** = polish.

### Scripts

#### A-01 (High) `su -c id` can open a root grant dialog
- **Where:** `scripts/devices.sh:93` (`timeout 6 "$adb" -s "$serial" shell 'su -c id </dev/null'`); `scripts/collect-device-report.sh:91` (same pattern). The comment at `devices.sh:92` ("Never prompt interactively") is wrong: closing stdin and a timeout do not stop Magisk or KernelSU from showing the grant dialog.
- **Why it matters:** D-011 says LeoCode never triggers a root prompt without the user opting in. These scripts run against D2 once it is rooted and would grant or prompt for the *shell* UID, and train the habit of running `su` casually.
- **Fix:**
  1. Remove every `su -c` call from `scripts/`. Report root state from read-only facts only: `command -v su`, the presence of `/data/adb/magisk`, `/data/adb/ksu`, or the packages `com.topjohnwu.magisk`, `me.weishu.kernelsu`, `me.bmax.apatch` (`pm list packages`).
  2. Print `root: su present (not tested)` or `root: no su`. Never claim "granted".
- **Accept when:** `grep -rn "su -c" scripts/` returns nothing; `scripts/devices.sh` on both phones prints a root line without running `su`.

#### A-02 (Medium) A lone Android 9 phone is assigned to the D2 slot
- **Where:** `scripts/devices.sh:68` (`[ "$(api_of "${connected[0]}")" -le 10 ]`). The script compares an **API level** against 10, as if it were an Android version. Android 9 is API 28, which is not `<= 10`, so a lone D1 lands in the `d2` slot. (The two-phone branch at lines 56–64 sorts by API and works.)
- **Fix:** compare against `28` (Android 9 = D1). Prefer: if the serial equals the configured `LEO_D1`/`LEO_D2`, use that; otherwise `api <= 28` → D1, else D2. Add a one-line comment saying "API level, not Android version".
- **Accept when:** with only D1 attached `./scripts/devices.sh --exports` prints `export LEO_D1=...` and no `LEO_D2`; with only D2 attached the reverse.

#### A-03 (High) `check-elf-alignment.sh` can report success when it checked nothing
All in `scripts/check-elf-alignment.sh`:
1. **Line 15:** `set -uo pipefail` has no `-e`. The script tracks `fail` by hand, but any unexpected error is ignored. Plan task text requires `set -euo pipefail`.
2. **Lines 81 and 100:** `"$readelf" -Wl "$so" 2>/dev/null | awk ...` hides readelf failures. A corrupt or non-ELF `.so` produces no `LOAD` lines and is printed as `ok ... (LOAD p_align none)`. Fix: run readelf into a variable, fail if its exit status is non-zero or if it returned no `LOAD` line.
3. **End of file (about lines 166–169):** when the APK contains no `.so` the script exits 0 ("nothing to verify"). In CI a packaging regression that drops `libleocodepty.so` would pass. Fix: exit 1 when `checked` is 0, unless a `--allow-empty` flag is given.
4. **Line 31:** `ANDROID_NDK_HOME` takes priority over the pinned NDK (`leocode.ndk` in `android/gradle.properties`). GitHub's `ubuntu-latest` presets that variable, so CI would use the runner's NDK. Fix: prefer the pinned `$sdk_dir/ndk/$ndk_pin`, fall back to the env var.
5. **Line 57:** zipalign `-P` support is detected by matching help text `"-P <pagesize_kb>"`. Fragile. Fix: run `zipalign -c -P 16 -v 4` on a tiny known-good file, or check the build-tools version is `>= 35`.
6. **Missing:** RELRO end-alignment check required by plan §4.3 (`(GNU_RELRO VirtAddr + MemSiz) % 0x4000 == 0`, or no writable data after it in the same LOAD segment). Add it with `llvm-readelf -Wl`.
7. **Scope:** only `lib/` inside the APK is scanned. The prototype ships an ELF executable at `assets/runtime/python3-launcher`; it is aligned today (checked: LOAD align `0x4000`) but nothing would catch a regression. Fix: also scan any ELF found under `assets/`.
8. **Context:** `useLegacyPackaging = true` (`android/app/build.gradle.kts:70`) stores libraries compressed, so the `zipalign -P 16` page check is trivially satisfied for them. The ELF check is the real gate; do not remove it.
- **Accept when:** a fixture APK with no `.so` fails; a fixture with a 4 KB-aligned `.so` fails; a text file renamed to `.so` fails; the real debug APK passes. Add these as small shell tests under `scripts/tests/` (or a CI step) so the script itself is tested.

#### A-04 (Low) `smoke.sh` and `collect-device-report.sh` defaults and gaps
- `scripts/smoke.sh:155` defaults to `LEO_D1` when no argument is given, while the docs use `"$LEO_D2"` in examples. Require an explicit serial or print usage.
- `scripts/smoke.sh:9`, `scripts/collect-device-report.sh:8`, `scripts/devices.sh:17`: `set -uo pipefail` without `-e`. Use `set -euo pipefail` and handle expected failures explicitly.
- `smoke.sh` does not record whether an old-target-SDK warning dialog appeared. Either capture `dumpsys window | grep -i mCurrentFocus` after launch or state in the report header that the dialog is a manual observation.
- The logcat filter in `smoke.sh` does not include `LeoCodeHarness`, and every D2 smoke report has an empty logcat section. Add the tag.
- `scripts/collect-device-report.sh:13` falls back to `LEO_D1` only.
- `scripts/devices.sh`: a configured serial that is not connected prints `NOT CONNECTED` but the script still exits 0. Exit non-zero when a requested device is missing.

#### A-05 (Low) `HarnessActivity` S1 treats an empty readable root as FAIL
- `HarnessActivity.kt` S1 test: `canList = entries > 0`. An empty but readable shared-storage root would report FAIL. Use "listing did not throw" as the condition.

### Documentation and evidence

#### A-06 (High) Docs still call D2 "rooted"
- `docs/test-matrix.md:34` header `D2 (A15, rooted)` contradicts `docs/test-matrix.md:17–19`, `PROGRESS.md:18` and the verified facts. Also check any other "rooted" label in the `Phase 0B` and `Root mode` tables. Plan v9 §Devices has already been corrected.
- **Fix:** relabel D2 columns "D2 (A15, unrooted)" until the owner roots it; leave the Root-mode table rows empty or `blocked: D2 not rooted`.

#### A-07 (Medium) Numbers in the matrix do not match the committed logs
The harness logs now committed under `docs/device-reports/` are the evidence. Replace or footnote matrix values that differ:

| Matrix claim | Committed log says | Source |
|---|---|---|
| D2 T1 "105 ms" | T1 104 ms, T2 105 ms | `20261111-harness-D2-e76846f.txt:17,24` |
| D1 T1 "403 ms" | 271 ms | `...harness-D1-192.168.29.26_5555.txt:21` |
| D2 T5 `rate=121359KB/s` | `80128KB/s`, 312 ms | `harness-D2:38` |
| D1 T5 "16.6 s (1506KB/s)" | 138.8 s, `180KB/s` (cold, Wi-Fi ADB) | `harness-D1:46` |
- Timing varies per run (documented in `PROGRESS.md` findings). **Fix:** quote the committed log values and add "(varies per run)", or commit the earlier raw logs.
- **Verified OK, no change needed:** SELinux domain `untrusted_app_27` on D2 and `untrusted_app` on D1 (`context=` in the logs), uid `u0_a554` / `u0_a90`, D2 S1 `entries=27` (`20261111-harness-D2-S1-e76846f.txt`), D1 S1 `entries=56`, `ro.debuggable=0`, `Enforcing`, no root manager (`20261111-phaseA-verification.txt`).

#### A-08 (Medium) Claims with no raw evidence anywhere in the repo
Remove or back each one:
- `docs/test-matrix.md:37` "D2 screenshot `20261111` run; app opened straight to the IDE": no screenshot exists. Either capture one (`adb -s e76846f exec-out screencap -p > docs/device-reports/...png`) after a fresh install, or change the note to "observed manually".
- `docs/test-matrix.md:164` and `PROGRESS.md:65` "`POST_NOTIFICATIONS` granted=false, app importance NONE": not in any report. Capture `dumpsys package dev.leocode | grep POST_NOTIFICATIONS` and `cmd notification` output, or soften.
- `docs/test-matrix.md:11` "SD845": true for a POCO F1 but not in any report; add `ro.board.platform` to `collect-device-report.sh`.
- "heap 256 MB": D2 log `harness-D2:11` (`heap : max 256 MB`) supports it.
- **T2c control build** (`test-matrix.md:40`, `PROGRESS.md:57`, `build.gradle.kts` property `leocode.controlTargetSdk`): the result `error=13, Permission denied` has no saved log, and the two files label the same result differently ("PASS (blocked as designed)" vs "FAIL as designed"). **Fix:** re-run once (`./gradlew assembleDebug -Pleocode.controlTargetSdk=29`, install on D2, run `--es run T2`, save logcat as `docs/device-reports/...-T2c-e76846f.txt`, rebuild at 28), and use one label everywhere: `BLOCKED (expected)`.
- `docs/test-matrix.md` Phase-1 rows on D2 marked `PASS (IDE shell boots)` or `PASS (dark rendered)` are visual observations; mark them "observed" or attach a screenshot.

#### A-09 (Medium) The 16 KB rows imply device coverage that does not exist
- `docs/test-matrix.md` "16 KB pages and native code" table (around lines 75–82) shows `**PASS** (4 KB)` under D1 and D2.
- **Fix:** write `n/a (device uses 4 KB pages; static check only)` and put the CI/local `check-elf-alignment.sh` result in the CI column. State plainly in the table intro that no tested device runs 16 KB pages.

#### A-10 (High) Task 2 and Task 3 are marked done, but their demos are not satisfied
- Task 2 demo: "CI green; APK installs and launches on D1 and D2". **CI has never run**; the branch is local only. `PROGRESS.md:102` says unit tests are "run in CI since Task 2", which is not true.
- Task 3 depends on A-01, A-02 and the evidence in A-07/A-08.
- **Fix:**
  1. Change both tasks to `[-]` (in progress) in `PROGRESS.md` and say what remains: "CI not yet run on GitHub; fix-ups A-xx pending".
  2. Add an "Open items" bullet: *CI verification needs a push; the owner chose to keep the branch local, so the YAML was validated by parsing only (jobs `web`, `android`, `nightly`, `python-runtime`; all 13 `uses:` pinned to SHAs that match their version tags).* Do not claim green CI.
  3. When the owner later pushes, run CI once and paste the result.

### Lower-priority items (track, do not block)

| ID | Item | Where | Handled by |
|---|---|---|---|
| A-11 | Lint baseline hides `RequiresFeature` for `postMessage` without a `WebViewFeature.WEB_MESSAGE_LISTENER` check; verify it is a real gap or a false positive, remove from baseline if fixed | `android/app/lint-baseline.xml`, `WebAppBridge.kt` | Task 6 / 8 |
| A-12 | `TrustAllX509TrustManager` ×3 baselined; all are inside bundled JGit/Bouncy Castle jars. Review when JGit/SSHD are wired in | `lint-baseline.xml` | Task 19 |
| A-13 | `/* ignore */` empty catch blocks pass `no-empty` because they contain a comment, but violate plan §7.4 | `web/src/components/TerminalPane.tsx:230,242` and 11 other `catch {}` sites | Task 12 |
| A-14 | `HarnessActivity` is `exported="true"` in the main manifest | `android/app/src/main/AndroidManifest.xml:34–35`, `HarnessActivity.kt` | Task 4 (fixed 2026-11-11) |
| A-15 | `fs.write` deletes the target before rename; `WebAppBridge.resolve()` ignores `Workspace.jail()` | `WebAppBridge.kt` | Task 4 (fixed 2026-11-11) |
| A-16 | Release build is signed with the debug key and R8 is off | `android/app/build.gradle.kts:48–49` | Task 28 |
| A-17 | Nightly job publishes a public **debug** APK on every push to `main` | `.github/workflows/ci.yml` job `nightly` | Task 28 |
| A-18 | `python-runtime` CI job is a stub (`if: false`) | `ci.yml` | Task 24 |
| A-19 | Two phones still use 4 KB pages, so 16 KB runtime behaviour is untested | n/a | Accept; record in D-014 |

---

## 4. Python prototype defects (commit `1a279a2`)

The owner chose to keep the Python installer prototype on `v9-impl`. It builds and passes tests, but it does **not** meet D-012 or plan §11. Plan v9 now makes Python the primary language (D-017) and puts Tasks 24–26 and 30–33 right after Phase C, so these defects must be fixed *then*, not now. They are listed so nobody mistakes the prototype for finished work. No on-device install has been run yet.

| ID | Sev | Defect | Evidence | Fixed by |
|---|---|---|---|---|
| P-01 | High | No Ed25519 signature or rollback counter. The only check is the SHA-256 in `assets/runtime/python.json`, which ships inside the APK | `core/RuntimeInstaller.kt:40–42, 284–314` | Task 24, 25 |
| P-02 | High | Launcher (`python3-launcher`, 6 240 bytes) is built on the laptop and committed as a binary; CI never builds or verifies it. Its ELF alignment is fine today (`0x4000`), but only because of the local flags | `assets/runtime/python3-launcher`, `scripts/build-python-launcher.sh`, `cpp/python_launcher.c` | Task 24 |
| P-03 | High | Extractor probably writes hardlinks, device nodes and FIFOs as empty regular files: the `else` branch that should reject them is unreachable if commons-compress `isFile()` returns true. Not tested. No setuid/setgid check, no size, file-count or ratio caps | `RuntimeInstaller.kt:373–379` | Task 25 |
| P-04 | High | Install swap is not atomic: `usr` → `usr.old`, then `usr.staging` → `usr`, with unchecked renames and `usr.old` deleted at once. The health check runs on the staging copy, not the installed copy. It replaces the whole `usr`, which would erase any second runtime | `RuntimeInstaller.kt:564–576` | Task 25 |
| P-05 | High | `ensurepip` runs from `usr.staging/bin/python3`, so the generated `pip` scripts will carry a `usr.staging` shebang that breaks after the rename (`python -m pip` still works) | `RuntimeInstaller.kt:467–472` | Task 24 (ship pip in the CI artifact), 25 |
| P-06 | Medium | Free-space check is `artifact size + 80 MB` against `workspace.root`; the download goes to `cacheDir` and the extracted tree plus old `usr` coexist | `RuntimeInstaller.kt:186–195` | Task 25 |
| P-07 | High | `Workspace.childEnv()` now sets `LD_LIBRARY_PATH=<usr>/lib`, `PYTHONHOME` and `SSL_CERT_FILE` for **every** child process, including `/system/bin` tools. Any `libssl`/`libcrypto` in `usr/lib` can be loaded into system binaries | `core/Workspace.kt:49–55` | Task 26, 30 (per-language env) |
| P-08 | Medium | `runtime.install` answers only when finished, but the bridge contract requires a reply within 10 s with later events. New codes `E_BAD_MANIFEST`, `E_INTEGRITY`, `E_HEALTH_CHECK` are not in the contract; other `IOException`s fall through to `E_INTERNAL` with raw exception text. It adds about 59 lines to the 787-line `WebAppBridge.kt`, which Task 6 deletes | `WebAppBridge.kt` (runtime methods), `docs/bridge-contract.md` | Task 5/6, 25 |
| P-09 | Low | Cancel stops the download and extraction loops but not a running `ensurepip` (timeout 180 s) or health-check process (30 s) | `RuntimeInstaller.kt` | Task 25 |
| P-10 | Medium | No on-device evidence of a successful install or health check on either phone. The CA bundle `assets/runtime/cacert.pem` (200 116 bytes) has no recorded source or hash. The manifest pins Python 3.14.10 (`python.org` returns HTTP 200 and the 23 027 305-byte size matches), but `python.org/ftp/python/` also lists 3.15.x and 3.16.0; the plan says "latest stable that ships an Android package", so confirm which is newest before pinning | `assets/runtime/python.json` | Task 24 |

**Reusable parts** when Tasks 24–26 are done properly: the launcher C source (sound: derives the prefix from `/proc/self/exe`, finds `libpython3.<n>.so`, `dlopen` + `dlsym("Py_BytesMain")`), the resumable HTTP-Range download, the staging directory idea, and the progress UI in `RuntimeManager.tsx`.

---

## 5. Evidence index (what exists now)

All under `docs/device-reports/`:

| File | What it proves |
|---|---|
| `20261111-141335-device.txt` | D2 device report: model, Android 15 / SDK 35, ABIs, `PAGE_SIZE 4096`, WebView 156.0.8078.47 |
| `20261111-phaseA-verification.txt` | **New.** Read-only `adb` facts for both phones: `ro.debuggable=0`, `Enforcing`, `getenforce`, no `su`, no root-manager package, app `targetSdk=28`, `PAGE_SIZE` |
| `20261111-harness-D2-e76846f.txt` | **New.** Full harness run on D2: T1 exit 0, T2 `exec-from-data-ok`, T3 pass, T4 exit 42, T5 25 MB bounded, T6 `pty-ok exit=7`, T7 inventory; S1 skipped (permission not granted at that time) |
| `20261111-harness-D2-S1-e76846f.txt` | **New.** S1 on D2 after granting storage: `entries=27 read=true write=true`, PASS |
| `20261111-harness-D1-192.168.29.26_5555.txt` | **New.** Full harness run on D1: T1–T7 and S1 all PASS (`entries=56`) |
| `20261111-T2c-e76846f.txt` | **New.** targetSdk-29 control build on D2: T2 fails with `error=13, Permission denied`; outcome labelled `BLOCKED (expected)`; phone restored to targetSdk 28 |
| `20261111-harness-final-D1-192.168.29.26_5555.txt`, `…-final-D2-e76846f.txt` | **New.** Final T1–T7 + S1 re-run on both phones with the shipped targetSdk-28 APK |
| `20261111-*-smoke-*.txt` | Cold-start measurements (D2 about 1.0 s median, 0.941 s best of five; D1 about 3.3 s) |

CI action hashes: all 13 `uses:` lines carry 40-character SHAs; every one matches its `# vN` tag when checked with `git ls-remote` (including `gradle/actions/setup-gradle@ed40850…`, which is the peeled commit of tag `v4`). The workflow parses as valid YAML.

---

## 6. What the next model must not do

- Do **not** change `targetSdk`, `minSdk`, permissions, or the `ExpiredTargetSdkVersion` lint disable (D-002).
- Do **not** start Phase B, the Python tasks, or any refactor of `WebAppBridge.kt` / `App.tsx` while closing Phase A.
- Do **not** run `su`, grant root, or change the phones' settings beyond `adb install`, `pm grant` for the app's own permissions, and `am start`.
- Do **not** push the branch or merge to `main` (owner decision).
- Do **not** delete the Python prototype; it stays until Tasks 24–26 replace it.
- Do **not** edit a number in `test-matrix.md` without a raw log under `docs/device-reports/` to cite.

---

## 7. Phase A exit checklist

Phase A closes when every box is checked. Record each result in `PROGRESS.md`.

- [x] A-01: no `su -c` anywhere under `scripts/`
- [x] A-02: single-phone slot assignment correct for D1 and D2
- [x] A-03: `check-elf-alignment.sh` fails on the three bad fixtures and passes on the real APK; `scripts/tests/` or CI covers it
- [x] A-04: smoke/report script defaults and exit codes fixed (Low, may batch)
- [x] A-05: S1 treats an empty readable root as PASS
- [x] A-06: no "rooted" label left on D2
- [x] A-07: matrix numbers match committed logs, or are footnoted as run-to-run variation
- [x] A-08: every unsupported claim is backed by a log/screenshot or softened; T2c re-run and logged, one label used everywhere
- [x] A-09: 16 KB rows say "static check only"
- [x] A-10: Tasks 2 and 3 show `[-]` with open items, or `[x]` only after CI has run
- [x] `npm run typecheck && npm run lint && npm test && npm run build` pass
- [x] `./gradlew testDebugUnitTest lintDebug assembleDebug` pass
- [x] `scripts/check-elf-alignment.sh` passes on the new debug APK
- [x] Harness T1–T7 + S1 re-run on D1 and D2 with the final APK; logs committed
- [x] Working tree clean; one commit per finding group

**Exit gate results (2026-11-11).** Web `lint` (0 errors, 11 pre-existing warnings), `test` (4/4),
`typecheck` and `build` pass. Android `testDebugUnitTest lintDebug assembleDebug` is green on the
final APK (`versionCode 2`, `targetSdk 28`). The ELF checker passes on `app-debug.apk`
(`libleocodepty.so` and `assets/runtime/python3-launcher`, both `LOAD p_align 0x4000`) and its
fixture suite passes 8/8. Final harness runs on D1 and D2 (T1–T7 + S1) are committed as
`docs/device-reports/20261111-harness-final-*.txt`; both phones were left on the targetSdk-28 build.
CI has still never run on GitHub — Tasks 2 and 3 stay in progress for that reason.

---

## 8. Hand-off prompt for the fixing model

Copy this to start the next session:

> You are fixing the Phase A findings of the LeoCode repo at `/home/sourav/Desktop/Apps/leocode` on branch `v9-impl`. Read `docs/reports/phase-a-analysis.md` completely, then `docs/LeoCode_Implementation_Plan_v9.md` §4.3, §12, §13 and the text of Tasks 2 and 3. Fix findings A-01 to A-10 in that order, one commit per group (scripts, docs/evidence, PROGRESS). Obey Section 6 of the report. For every doc change, cite a raw log in `docs/device-reports/`. Both phones are attached (`adb devices -l`: D1 `192.168.29.26:5555`, D2 `e76846f`); always use `-s`. Finish by running the exit checklist in Section 7 and report each box with the command output. Do not start Phase B.
