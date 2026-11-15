# LeoCode

An Android coding IDE: file explorer, CodeMirror editor, terminal, Git/SSH, and
on-demand language runtimes — running entirely on the phone, rooted or unrooted.

> **Status: plan v9, Phase A complete (production restructure).** The IDE shell runs on Android 9
> (D1) and Android 15 (D2). D2 is measured but currently **unrooted** (no `su`): root mode
> (Phase E) waits for a root manager. Not production-grade yet: see the audit in plan v9 §3.
> Live task list: [`PROGRESS.md`](PROGRESS.md) · Plan: [`docs/LeoCode_Implementation_Plan_v9.md`](docs/LeoCode_Implementation_Plan_v9.md)
> · Picking this up? Start with [`docs/HANDOFF.md`](docs/HANDOFF.md).

## Key decisions

| | |
|---|---|
| Distribution | Direct APK (GitHub Releases). **Not Google Play.** |
| targetSdk | **28** — required to `execve()` downloaded binaries (Termux's approach) |
| Package ID | `dev.leocode` |
| UI | React + TypeScript + Vite in a WebView, CodeMirror 6, xterm.js |
| Git/SSH | JGit + Apache MINA SSHD + Bouncy Castle (no native binaries) |
| Python | official python.org Android CPython + our NDK launcher (D-012) |
| Terminal | xterm.js over our own JNI PTY — no GPL code |
| Android | 9 – 16 (API 28–36), arm64-v8a; measured on Android 9 (unrooted) and 15 (currently unrooted) |
| Root | optional, opt-in root mode; never prompts at startup (D-011) |

## Layout

```
android/              Kotlin host (WebView IDE, bridge, JNI PTY, debug harness)
web/                  React/TS IDE shell (real bridge on device, mock bridge in the browser)
runtime-manifests/    signed runtime metadata + schema
runtime-packaging/    CPython/wheel packaging notes (Task 24)
docs/                 plan v9, decisions, bridge contract, UX, test matrix
.github/workflows/    CI (web build, APK build, nightly)
```

## Web UI (works today, mock bridge)

```bash
cd web
npm ci
npm run dev        # http://127.0.0.1:5173
npm run build      # typecheck + production bundle
```

## Android (harness)

Requires JDK 17, Android SDK (platform 34, build-tools 35.0.0 for the 16 KB
zipalign check, CMake 3.22.1, NDK r28 / 28.2.13676358). Keep the JDK path in
`~/.gradle/gradle.properties` (`org.gradle.java.home`), not in the repo.

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
cd android
./gradlew assembleDebug
bash ../scripts/check-elf-alignment.sh          # 16 KB ELF + zipalign gate
../scripts/devices.sh                            # resolve LEO_D1 / LEO_D2
../scripts/smoke.sh "$LEO_D2"                    # install, cold start, logcat
```

CI installs the same NDK pin, runs unit tests and blocking lint, and uploads the
APK as an artifact.

## On-device checklist

Full steps, including running both phones on one USB cable via Wi-Fi ADB:
[`docs/phase0-runbook.md`](docs/phase0-runbook.md).

1. D1 (Redmi, Android 9): USB debugging, MIUI "Install via USB", "USB debugging (Security settings)".
   D2 (Android 15, rooted): USB debugging; do not pre-grant root to LeoCode.
2. `adb devices -l` shows the device(s).
3. Install the debug APK, run the harness T1 … T7, record results in
   [`docs/test-matrix.md`](docs/test-matrix.md).
4. Gate: WebView ≥ Chromium 100, `T2 exec` passes, `T6 pty` passes — on every device.

## Security posture (short)

- No secrets cross the bridge; keys are Keystore-wrapped (AES-GCM) and never written in plaintext.
- Every path from JS must be canonicalised and jailed to the workspace / shared-storage roots.
  **Known gap:** the current bridge bypasses this check; Task 4 fixes it (plan v9 §3).
- Root mode is opt-in, warned and badged; file APIs never accept root paths (D-011).
- Bridge = `addWebMessageListener` on the asset origin only. No `addJavascriptInterface`.
- Executed project code has the app's UID (D-008). Only run projects you trust.
- Preview (later) gets a separate WebView with no bridge and no file access.

## License

TBD. The MVP avoids GPL dependencies (D-004, D-005), leaving the choice open.
