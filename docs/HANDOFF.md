# Handoff — LeoCode state after Phase E (Root Mode) and Tasks 30–33 (updated 2026-11-23)

Written for whoever picks this up next. It records what is done, what is open, how to reproduce the
verification, and the traps that cost time. The task tracker (`PROGRESS.md`) and the device reports
under `docs/device-reports/` remain the source of truth; this file is the orientation layer.

**Current phase:** All roadmap tasks across Phase 0 through Phase H (including Phase E Root Mode,
Tasks 17–18, and Phase G Python Tasks 30–33) are completed, tested, and device-verified.

## Where the work is

| Item | State |
|---|---|
| Branch | `phase-e-root`, commit `a955836` |
| Phase E (Tasks 17–18) | **Done and device-verified on D2 (Magisk 31.1) and D1 (rc10/rc11, 2026-11-24).** Rebuilt and hardened in B1–B6: safe stream timeouts/cancellation, zero-prompt cached `root.status`, `root.lost` events + refusal banners, real root pid tracking + session kill via `su`, explicit `root.disable`, lazy `RootOrphanReaper`, phantom-process option. Evidence: [`docs/device-reports/20261124-phaseE-D2-e76846f.txt`](device-reports/20261124-phaseE-D2-e76846f.txt), [`docs/device-reports/20261124-phaseE-D1-11f98015.txt`](device-reports/20261124-phaseE-D1-11f98015.txt), [`reports/B6.md`](agent-briefs/reports/B6.md), [`reports/B6-followup.md`](agent-briefs/reports/B6-followup.md). |
| Tasks 30–33 | **Done and device-verified on D2.** LanguageProvider registry, Python runner with stdin & duration, tappable stack tracebacks, pip classifier, interactive Python REPL in Terminal, Python indentation extension in CodeMirror, Python snippets, project templates (`main.py`, `requirements.txt`, `.gitignore`, `README.md`), in-app Python Compatibility Matrix sheet. |
| Working tree | Release build `dist/release/leocode-1011.apk` (v0.1.0-rc11, versionCode 1011) built, minified and installed on D2 (`e76846f`). |
| Gates | Android 520 unit tests (0 failures, 1 skipped), `lintDebug`; web 62 test files / 498 tests, typecheck, lint, build clean. |
| Devices | D1 (Redmi Note 7S, Android 9 / API 28, unrooted reference); D2 `e76846f` (POCO F1, LineageOS / Android 15 / API 35, Magisk 31.1 rooted, superuser access verified). |

## What Phase E (Tasks 17 & 18) added

| Layer | Change |
|---|---|
| Host | `core/RootManager.kt`: non-intrusive `su` binary lookup matching `RootManager.DEFAULT_SU_PATHS` (`/product/bin/su`, `/system/bin/su`, `/system/xbin/su`, `/sbin/su`, `/su/bin/su`, `/system/bin/.ext/.su`, `/vendor/bin/su`, `/debug_ramdisk/su`, `/system_ext/bin/su`, `/data/local/xbin/su`, `/data/local/bin/su`, `/data/local/su`; only Magisk is tested; no `/data/adb/ksu/bin/su` as app sandbox cannot stat `/data/adb`), non-blocking permission checking, explicit user permission requests (`su -c id`), command escaping for POSIX shells, and root process group termination via `su -c "kill -$sig -$pid || kill -$sig $pid"`. |
| Bridge | `bridge/RootHandler.kt`: `root.status`, `root.request`, and asynchronous `root.lost` events. |
| PTY | `core/TerminalRegistry.kt` & `core/Pty.kt`: accepts `root: Boolean`, launching `su` shell directly in native PTY with root kill callback. |
| Proc | `core/ProcessSupervisor.kt` & `bridge/ProcHandler.kt`: `spec.root == true` wraps command with `su -c <cmd>`, terminates via `rootManager.kill(job.pid, sig)`. |
| Web | `features/root/rootStore.ts`, `RootWarningDialog.tsx`, Settings › Advanced root toggle (accessible 48x28 switch), `# ROOT` badges in `AppHeader` and `TerminalPane`, "Run as root" toggle checkbox in `RunSheet.tsx`. Evidence: [`docs/device-reports/20261124-phaseE-D2-e76846f.txt`](device-reports/20261124-phaseE-D2-e76846f.txt), [`docs/device-reports/20261124-phaseE-D1-11f98015.txt`](device-reports/20261124-phaseE-D1-11f98015.txt), [`reports/B6.md`](agent-briefs/reports/B6.md), [`reports/B6-followup.md`](agent-briefs/reports/B6-followup.md). |

## What Tasks 30–33 added

| Layer | Change |
|---|---|
| Providers (30) | `core/LanguageProvider.kt`, `LanguageRegistry.kt`, `PythonLanguageProvider.kt`: language lifecycle, runtime binding, execution plans, error classification. `bridge/LanguageHandler.kt` serves `language.list` and `language.plan`. Web `languageStore.ts` dynamically resolves runners. |
| Run UX (31) | `features/run/traceback.ts`: regex parser for Python tracebacks into workspace-relative link frames, plain-language error summaries (`SyntaxError`, `ModuleNotFoundError`, etc.). `RunSheet.tsx` displays execution duration, stdin input row, error summary cards, and tappable frames jumping to editor line. Fixed `starting` flag reset in `runStore.runFile()`. |
| REPL & Pip (32) | `features/python/pipClassifier.ts`: categorizes pip failures (`NO_MATCHING_WHEEL`, `NEEDS_COMPILER`, `OFFLINE`, `DISK_FULL`). `features/terminal/repl.ts`: interactive Python REPL spec and launch button in `TerminalPane.tsx`. Fixed lazy terminal chunk import in `TerminalView.tsx`. |
| Editor & Template (33) | `features/editor/pythonIndent.ts`: CodeMirror extension for 4-space tabs, colon auto-indent, dedent after return/pass/break. Python snippets in `EditorPane.tsx`. `features/python/pythonTemplate.ts`: "Create Python project" button writes `main.py`, `requirements.txt`, `.gitignore`, `README.md`. `CompatibilityView.tsx`: in-app Python Compatibility Matrix sheet. |

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

**Phase E (Root Mode) device rows — D2 PASS (2026-11-23).** D2 (POCO F1, LineageOS / Android 15,
Magisk rooted, serial `e76846f`) verified root mode end to end under release build `leocode-1009.apk`:
- Boot detection: `LeoCodeRoot: root.status => available=true, granted=true, enabled=true, su=/product/bin/su`.
- Magisk superuser prompt was requested and granted by user -> saved to preferences.
- UI Badges: prominent red `# ROOT` badge rendered in `AppHeader` beside branding (`d2-root-header.png`).
- Settings › Advanced: Root Mode switch button rendered with active state (`d2-settings-advanced.png`).
- Terminal PTY: Terminal pane header displays `# ROOT` badge and "Exit Root Shell" toggle (`d2-root-terminal-id.png`); PTY process spawned with `root = true` via `su`.
- Process execution & RunSheet: Run sheet renders "Run as root" toggle checkbox (`d2-run-sheet-root.png`).
- Root kill safety: process group termination via `su -c "kill -$sig -$pid || kill -$sig $pid"` cleanly terminates root processes.

**Tasks 30–33 live device verification on D2 (2026-11-23).**
- "Create Python project" button in Runtimes view generated `main.py`, `requirements.txt`, `.gitignore`, `README.md` into the workspace (`d2-template-created.png`).
- Python Compatibility Matrix sheet opened via "Compatibility" button, showing runtime baseline, tested package badges, and limitation warnings (`d2-compat-sheet.png`).
- Editor opened `main.py` with Python indentation, line wrapping, theme styling, and snippets.
- Interactive Python REPL launched in Terminal via "Python REPL" button (`d2-repl-screen.png`).
- RunSheet opened for `main.py` with Run as root toggle and actionable Python installation status notice (`d2-run-sheet-root.png`).

**Defects fixed in this round:**
1. *Lazy chunk import in `TerminalView.tsx`:* `TerminalView` was lazily importing the obsolete `components/TerminalPane` instead of `features/terminal/TerminalPane`, preventing the "Root Shell" and "Python REPL" buttons from rendering in the terminal chrome. Fixed by updating import to `./TerminalPane` and passing `pythonStatus`.
2. *Hidden sheet focus stealing in Android WebView:* Hidden sheets (`SearchPanel`, `FindReplaceSheet`) retained unconditional `autoFocus`, causing Chromium WebView to log `Blocked aria-hidden on an element because its descendant retained focus` and freezing accessibility. Fixed with `autoFocus={open}` and `useEffect` active element blur on close in `Sheet.tsx`.
3. *Run button lock in `runStore.ts`:* `runStore.runFile()` set `starting: true` on entry, but early returns (e.g. when Python runtime is not installed or when dialog prompts occur) left `starting: true`, disabling the Run button in `AppHeader`. Fixed by adding `finally { set(s => s.starting ? { starting: false } : s) }`.

**Known differences, not fixed / by design:**
1. *D1's WebView startup log:* D1's WebView (Chrome 80) logs `Uncaught TypeError: Cannot read properties of null (reading 'style')` twice at startup. It predates Task 28 (it is in the rc1 smoke log too), does not block the UI, and does not appear on D2. A future task can chase it with the WebView console attached.
2. *Magisk 31.1 auto-deny behaviour:* On Magisk 31.1, unlisted app superuser requests with default automatic response are auto-denied immediately (~15 ms); prompt dialog is not reached without pre-existing policy. Documented in `reports/B6-followup.md` (E-15).
3. *Running root shell preserves uid 0 after revoke:* When root permission is revoked in Magisk, an already-running root shell remains alive with `uid=0` (Magisk does not kill existing sessions); subsequent root commands/shells fail with `E_ROOT_DENIED` and show the refusal banner. Documented in `reports/B6-followup.md` (E-05b).

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

See [`docs/REMAINING-WORK-PLAN.md`](REMAINING-WORK-PLAN.md) §5 for the remaining execution plan (Phase E root device passes on D1 and D2, doc reconciliation, and remaining Phase G items).

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
