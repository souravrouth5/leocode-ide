# LeoCode

An Android coding IDE: file explorer, CodeMirror editor, terminal, Git/SSH, and
on-demand language runtimes — running entirely on the phone, unrooted.

> **Status: Phase 0 (feasibility).** The Android app is a device test harness, not the IDE.
> The web UI runs against a mock bridge. Nothing runs on a phone yet.
> Live task list: [`PROGRESS.md`](PROGRESS.md) · Plan: [`docs/LeoCode_Implementation_Plan_v8.md`](docs/LeoCode_Implementation_Plan_v8.md)

## Key decisions

| | |
|---|---|
| Distribution | Direct APK (GitHub Releases). **Not Google Play.** |
| targetSdk | **28** — required to `execve()` downloaded binaries (Termux's approach) |
| Package ID | `dev.leocode` |
| UI | React + TypeScript + Vite in a WebView, CodeMirror 6, xterm.js |
| Git/SSH | JGit + Apache MINA SSHD + Bouncy Castle (no native binaries) |
| Python | system shell + NDK-built CPython (Track C2); full userspace rebuild deferred |
| Terminal | xterm.js over our own JNI PTY — no GPL code |

## Layout

```
android/              Kotlin app (Phase 0B harness + JNI PTY)
web/                  React/TS IDE shell (mock bridge)
runtime-manifests/    signed runtime metadata + schema
runtime-packaging/    CPython/wheel build scripts (Phase 0C)
docs/                 plan, decisions, bridge contract, UX, test matrix
.github/workflows/    CI (web build, APK build)
```

## Web UI (works today, mock bridge)

```bash
cd web
npm ci
npm run dev        # http://127.0.0.1:5173
npm run build      # typecheck + production bundle
```

## Android (harness)

Requires JDK 17, Android SDK (platform 34, build-tools 34.0.0, CMake 3.22.1, NDK r27).

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
cd android
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

CI installs the toolchain and uploads the APK as an artifact.

## Phase 0 on-device checklist

1. Connect the Redmi (USB debugging, MIUI "Install via USB", "USB debugging (Security settings)").
2. `adb devices -l` shows the device.
3. Install the debug APK, open **LeoCode**, tap **T1 … T7**, record results in
   [`docs/test-matrix.md`](docs/test-matrix.md).
4. Gate: WebView ≥ Chromium 100, `T2 exec` passes, `T6 pty` passes.

## Security posture (short)

- No secrets cross the bridge; keys are Keystore-wrapped (AES-GCM) and never written in plaintext.
- Every path from JS is canonicalised and jailed to the workspace root.
- Bridge = `addWebMessageListener` on the asset origin only. No `addJavascriptInterface`.
- Executed project code has the app's UID (D-008). Only run projects you trust.
- Preview (later) gets a separate WebView with no bridge and no file access.

## License

TBD. The MVP avoids GPL dependencies (D-004, D-005), leaving the choice open.
