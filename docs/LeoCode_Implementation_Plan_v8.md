# LeoCode — Implementation Plan v8

Android coding IDE. Supersedes v7.

**Status:** scope, architecture and Phase-0 decisions are frozen. Runtime feasibility is still unproven and is gated by Phase 0. Sprint tracking lives in [`PROGRESS.md`](../PROGRESS.md).

**v8 changes (all findings from the v7 review are resolved):**
1. Terminal licensing fork **decided**: no GPL. MVP terminal is xterm.js over our own JNI PTY. Termux `terminal-view` is dropped from the baseline and kept only as an optional GPL-mode variant.
2. WebView version promoted to a **hard Phase-0 gate** (minimum Chromium 100), with a defined degraded mode.
3. Shared-UID security reality added to the threat model, with mitigations.
4. Phase 0 split into **parallel tracks** and re-estimated. A cheaper Python path (system shell + NDK-built CPython) is now the MVP track; the full userspace rebuild is an optional compatibility track.
5. Plan B replaced with a concrete decision tree, including the "LeoCode IDE + Termux backend" product.
6. Per-phase schedule, UX spec, bridge contract, test-matrix template and performance budget added.

**Test devices**
- Device 1: Redmi Note 7S, 4 GB RAM, 64 GB, unrooted, MIUI, Android 9.
- Device 2: Snapdragon 695 phone, Android 11.
- Device 3 (required before freezing decisions): any Android 14+ device.

**Dev environment:** Linux Mint laptop, physical phones over USB, GitHub Actions for builds.

---

## 1. Decisions (frozen)

| ID | Decision | Choice | Consequence |
|---|---|---|---|
| D-001 | Distribution | Direct APK via GitHub Releases. **Not Google Play.** F-Droid only if the app is fully FOSS. | No Play policy constraints; users sideload; self-update UI required. |
| D-002 | targetSdk / compileSdk | targetSdk **28**, compileSdk 34, minSdk 28 | Legacy storage + `execve()` of app-written binaries allowed. Installs on Android 9–16 today, but the floor rises over time (§4). |
| D-003 | Package ID | **`dev.leocode`** | Fixed forever: changing it invalidates every runtime package and the SSH key store. Prefix is `/data/data/dev.leocode/files/usr` (33 chars, safe for `#!`). |
| D-004 | Terminal UI | **xterm.js inside the IDE WebView + our own JNI PTY.** No GPL code. | Keeps licensing free. Native Termux view is an optional later swap (GPLv3, whole-app). |
| D-005 | Git / SSH | **JGit + Apache MINA SSHD + Bouncy Castle**, in-process. | No binary dependency, no Phase-0 comparison needed. Native git deferred to the userspace track. |
| D-006 | Python runtime | **MVP: system shell (`/system/bin/sh` + toybox) + NDK-built CPython**, our own wheel index for native packages. Full Termux-style userspace is a later compatibility track. | Cuts Phase 0 by weeks; native extensions limited to packages we build. |
| D-007 | WebView minimum | **Chromium 100+**, hard gate. | `addWebMessageListener` (WebView 88+) and CodeMirror 6 need it. Degraded mode defined (§6). |
| D-008 | Security posture | All executed code shares the app UID. | Documented, not fixable unrooted. Mitigations in §11. |
| D-009 | Secrets | Keystore-wrapped AES-GCM key encrypts key material; plaintext keys exist only in memory, briefly. | No plaintext key files on disk. |
| D-010 | Preview | Separate restricted WebView, `127.0.0.1` only, random port + token. | No bridge, no file access. |

### Decision records
`docs/decisions/README.md` aggregates D-001…D-010. Each record states context, choice, alternatives, and the trigger that would reopen it.

---

## 2. Review findings and their resolution

Severity: C = can kill the project, H = can cost weeks, M = will cost days, L = polish.

| # | Sev | Finding | Resolution in v8 |
|---|---|---|---|
| 1 | C | Android 10+ blocks `execve()` of app-written files for targetSdk ≥ 29. | D-002. Verified on Android 9/11/14 in Phase 0B. |
| 2 | C | Termux binaries hardcode `/data/data/com.termux/files/usr`. | Only relevant to the optional userspace track. MVP track ships CPython built with our prefix (D-006). |
| 3 | C | Low targetSdk may stop installing on future Android. | Watch §4. Plan B tree (§14). |
| 4 | C | WebView may be too old for `addWebMessageListener` + CodeMirror 6. | D-007 hard gate in 0A. Degraded mode defined. |
| 5 | C | Terminal libraries are GPLv3 and linked into the APK; "separate process" mitigation is invalid. | D-004: xterm.js + own PTY. GPL path documented as opt-in only. |
| 6 | H | `pip`: manylinux wheels are glibc; no compiler on device. | Own wheel index built in CI for `android-aarch64`; documented compatibility matrix. |
| 7 | H | Android 12+ phantom-process killer and MIUI battery policy kill children. | Foreground service, wake lock, orphan reaping, in-app setup guide. 0E/0F tests. |
| 8 | H | Keystore cannot hold OpenSSH/Ed25519 keys; OpenSSH needs a key file. | In-process SSH (D-005) + envelope encryption (D-009). No OpenSSH on the MVP path. |
| 9 | H | Ed25519/Curve25519 missing before API 33. | Bundle Bouncy Castle; unit tests on API 28. |
| 10 | H | Bridge underspecified; `addJavascriptInterface` exposes to all frames. | `addWebMessageListener`, origin allowlist, typed schema, path jail (§10, `docs/bridge-contract.md`). |
| 11 | H | Preview server reachable by other apps on loopback. | D-010. |
| 12 | H | Executed project code has the app's UID and can read other projects / key blobs. | **New in v8.** Threat model §11. Mitigations: per-project encryption option, short plaintext lifetime, explicit warning, no plaintext keys. |
| 13 | H | Runtime/self-update integrity vague; HTTPS is not authentication. | Signed manifests (Ed25519, offline key), rollback counters, signed APK verification (§7). |
| 14 | H | Phase 0 estimate and sequencing wrong. | Re-planned and re-estimated (§6, §15). |
| 15 | M | Project code executes via sdists, venv scripts, git hooks too. | Trust prompt covers every execution path (§11). |
| 16 | M | SAF returns content URIs, not paths. | Copy-in/copy-out import/export in Phase 1. |
| 17 | M | Private workspaces vanish on uninstall; Auto Backup may copy secrets. | `allowBackup=false`; zip export/backup; uninstall warning. |
| 18 | M | Shebangs limited (~127 bytes); long paths break pip scripts. | Short package ID (D-003); prefer `python -m` entry points. |
| 19 | M | No cgroups unrooted; `Process.destroy()` kills only the parent. | `setsid()` + process-group kill via JNI; watchdog; orphan reaping. |
| 20 | M | Terminal escape sequences and unescaped output are injection vectors. | OSC 52 disabled, title sanitising, no `dangerouslySetInnerHTML`, CSP. |
| 21 | M | Native terminal over WebView is a layout/IME risk. | Removed with D-004; xterm.js has its own mobile criteria in 0E. |
| 22 | M | MIUI: autostart, battery saver, extra USB toggles, stale WebView. | 0A/0E checklist and in-app setup guide. |
| 23 | M | Git scope lacked HTTPS token auth. | Added (§10, Phase 3). |
| 24 | M | ABI check used only `ro.product.cpu.abi`. | `abilist` + `getconf PAGE_SIZE` in 0A. |
| 25 | M | CI and supply chain: signing keys, fork PRs, unpinned actions, public debug APKs. | §13 rules. |
| 26 | M | No UX design; mobile editor UX is the product. | UX spec added (`docs/ux-spec.md`), Phase 2 acceptance criteria. |
| 27 | M | No schedule beyond Phase 0. | §15. |
| 28 | L | Browser-only UI work never exercises the bridge. | Mock bridge + on-device CI smoke test (§13). |
| 29 | L | No crash-safe writes, draft recovery, external-change detection. | Phase 2. |
| 30 | L | No licensing review. | §12. |
| 31 | L | Bootstrap contents unspecified. | §7.3 explicit package list, incl. `ca-certificates`, `terminfo`, `TMPDIR`. |
| 32 | L | `getconf` may be missing on older toybox. | Fallback: tiny native helper in the 0A harness. |
| 33 | L | Bridge types can drift between Kotlin and TS. | Generate TS types from Kotlin `@Serializable` models (§10). |

---

## 3. Product goal and release scope

An Android environment where users manage project files, edit code with syntax highlighting, use an integrated terminal, run supported language runtimes locally, use Git and SSH, and preview local web projects when the runtime supports it. Runtimes install on demand. Git and SSH never depend on any runtime.

**MVP (release 0.1)**
1. Core IDE: workspaces, file explorer, editor, tabs, search, terminal.
2. Git: clone, init, status, add, commit, diff, log, branch, checkout, pull, push, conflicts. SSH keys and HTTPS tokens.
3. SSH: key generation/import, protected storage, host-key verification.
4. Python: interpreter, pip, venv, run file, run command.

**Later:** Node.js (npm, Vite, preview) → Java (JDK, then Maven/Gradle) → PHP (CLI, dev server, then Composer).

No promise that arbitrary PyPI/npm packages work. Bionic, not glibc; native extensions only when we ship a wheel. Compatibility matrix is a publishable artifact, per device and Android version.

---

## 4. Execution model

Apps targeting API 29+ cannot `execve()` files written into their own data directory. LeoCode targets 28, as Termux does.

Accepted consequences:
- No Google Play.
- Android 14 refuses targetSdk < 23, Android 15 refuses < 24. The floor rises roughly one level per release, so targetSdk 28 is a **countdown clock**, not a permanent solution. Watch each Android release; when the floor reaches 29, switch to plan B (D-006 fallback ladder, §14).
- Legacy storage semantics; projects stay in app-private storage anyway.
- Every Phase-0 test runs on Android 9, 11 and (required) 14+.
- A control build at targetSdk 29+ on the Android 11 phone documents the block. Not a product path.

---

## 5. Architecture

```
React + TypeScript IDE UI (WebView)          xterm.js terminal (same WebView)
                  \                                /
                   \--- typed bridge (postMessage) -/
                                  |
                          Kotlin host (Activity/Service)
                                  |
        +---------------+---------+---------+----------------+
        |               |                   |                |
   Workspace        Git / SSH          Process Manager   Preview (2nd WebView)
        |               |                   |
        +---------------+---------+---------+
                                  |
                            Runtime Manager
                                  |
                     Runtime provider (Python → Node → Java → PHP)
                                  |
                       native: PTY (JNI), process groups
```

**Rules**
- React UI knows nothing about Android; all platform access goes through the versioned bridge.
- Every long operation is async and streams events. No blocking on the UI thread. No file I/O, hashing or Git on the main thread.
- Output is bounded and coalesced (backpressure) so floods cannot freeze the WebView.
- Git/SSH are independent of runtime installation.
- A generic runtime-provider interface exists before Python is added. No Python assumptions in the process manager.
- Projects live in app-private storage; SAF is import/export only.
- Terminal, editor and process layers are separate modules.
- Native PTY is the only native code; everything else is Kotlin/JVM.

---

## 6. Phase 0 — feasibility (4–6 weeks)

Phase 0 is the project. Nothing user-facing is built until its exit criteria pass.

**Gate 0 (before coding, ~1 day)**
- D-001…D-010 recorded in `docs/decisions/`.
- Package ID fixed: `dev.leocode`.
- Repository scaffold committed, CI green on an empty app.

### 0A — device and build environment (2–3 days)
Install `adb`, JDK 17+, Android cmdline-tools, platform-tools, `platforms;android-34`, `build-tools;34.0.0`, NDK, CMake.

On the Redmi: Developer options, USB debugging, **Install via USB**, **USB debugging (Security settings)** (needs MI account).

Per device:
```
adb devices -l
adb shell getprop ro.product.cpu.abilist
adb shell getprop ro.build.version.release
adb shell getprop ro.build.version.sdk
adb shell getprop ro.build.version.security_patch
adb shell getprop ro.product.model
adb shell getprop ro.miui.ui.version.name
adb shell df -h /data
adb shell cat /proc/meminfo
adb shell dumpsys webviewupdate
adb shell dumpsys package com.google.android.webview | grep -i versionName
adb shell getconf PAGE_SIZE            # fallback: native helper in the harness
adb shell ls /system/bin | head -50    # toybox applet availability
```

**Gate 0A:** WebView major version ≥ 100 on every supported device.
- If < 100 but updatable via Play Store → require the update in onboarding.
- If not updatable → **degraded mode**: editor falls back to a plain textarea + Prism, terminal falls back to line-mode command runner, bridge uses a token-checked `WebViewClient.shouldInterceptRequest` channel instead of `addWebMessageListener`. Degraded mode is documented, not silently shipped.

**Deliverable:** device report per phone, minimal targetSdk-28 app installed on both.

### 0B — process execution (3–5 days, parallel with 0A)
Harness app: create files in private storage, run `/system/bin/sh -c ...`, capture stdout/stderr/exit, kill a process **group**, report failures.

Tests, on both phones: (1) `/system/bin/sh`; (2) a binary copied into app data and exec'd; (3) `setsid` group kill; (4) exit-code propagation; (5) output flood (`yes`, 50 MB) with bounded buffers; (6) control build at targetSdk 29 to document the block.

**Deliverable:** results table per device, in `docs/test-matrix.md`.

### 0C — Python, pip, venv (2–3 weeks, split)
**Track C2 (MVP, do this first)**
1. Validate terminal substrate: `/system/bin/sh`, toybox applets, `TERM`, `TMPDIR` → app cache, `HOME` → app files, `PATH=/system/bin`.
2. Build CPython with the NDK in CI, prefix `/data/data/dev.leocode/files/usr`, static-ish (`--disable-shared` or bundle `libpython`), `PYTHONHOME` set.
3. Tests: `python --version`, script run, `python -m pip --version`, `python -m venv .venv`, activate, `pip install requests`, `pip install <pure-python package with a console script>`.
4. Native extension test: build one wheel (e.g. `markupsafe` or `ujson`) for `android-aarch64` in CI, install from our index, import it.
5. Record what fails and why.

**Track C1 (optional compatibility, only if the product needs broad `pip`)**
Fork `termux-packages`, set `TERMUX_PREFIX=/data/data/dev.leocode/files/usr`, build a bootstrap set (bash, coreutils, python, pip, openssl, ca-certificates, libffi, zlib, sqlite, ncurses, readline, terminfo, make, tar, curl). Expect to patch the build system and several per-package prefix assumptions. 3–5 weeks plus 1–3 days/month maintenance. Do **not** start this before C2 proves the product.

**Deliverable:** Python baseline, pip/venv results, compatibility notes, CI-built artifact + manifest.

### 0D — Git and SSH (3–4 days, no longer blocked by 0C)
JGit only for MVP; no native-git comparison. Tests: clone, status, add, commit, diff, log, branch, checkout, pull, push over SSH and HTTPS token.

SSH via MINA SSHD + Bouncy Castle: key generation (Ed25519, RSA), import (OpenSSH, PEM, PKCS#8), passphrase-protected keys, host-key prompt with SHA-256 fingerprint, changed-key hard failure, and error paths (wrong key, timeout, offline, DNS).

Record JGit gaps: no hooks, no LFS, limited submodule/shallow behaviour.

**Deliverable:** working clone/push on both devices; keys never in logs or WebView.

### 0E — PTY and terminal (1–2 weeks)
Native `openpty`/`fork`/`setsid`/`execvp` JNI layer (already scaffolded in `android/app/src/main/cpp/pty.c`). Validate:
- interactive shell I/O, resize, Ctrl+C, Ctrl+D
- process-group kill and orphan reaping after app death
- long-running script + backgrounding + reopen
- output flood with xterm.js attach/detach
- xterm.js on-device: keyboard open/close layout, `visualViewport` resize, scrollback, selection, extra-keys row (Ctrl, Esc, Tab, arrows)
- OSC 52 disabled; titles sanitised

**Pass/fail:** no layout jump when the keyboard opens; no lost keystrokes; no ANR; terminal survives a tab switch without leaking a process.

**Deliverable:** terminal decision confirmed (or the GPL native-view escalation triggered, if xterm.js fails the IME criteria and the app is going GPL).

### 0F — cross-device validation (3–5 days)
Run 0B/0C/0E on Android 11 and Android 14+. Record everything in the matrix.

### Phase 0 exit criteria
- ADB reliable; ABI, page size, WebView version documented per device.
- Exec works unrooted on Android 9 **and** 11 **and** 14+ at targetSdk 28.
- Python, pip, venv work per the documented baseline; one native wheel imports.
- Clone/pull/push over SSH and HTTPS token work.
- Host-key verification works; no key material in logs.
- Interactive PTY, resize, cancellation and group kill demonstrated.
- Backgrounding, process death and MIUI behaviour documented.
- CI produces a signed debug APK and a Python artifact from a clean runner.

If any of the three C-level criteria fail, stop and take the plan-B tree (§14) before writing UI code.

---

## 7. Runtime Manager and supply chain

### 7.1 Responsibilities
List/install/verify/update/uninstall runtimes; resolve executables and environment; start/stop/supervise processes; stream output and state; manage per-project environments; verify manifests and archives; enforce resource limits best-effort.

### 7.2 Manifest
```json
{
  "schema": 1,
  "id": "python",
  "version": "3.11.9",
  "abi": ["arm64-v8a"],
  "minAndroid": 28,
  "artifact": { "url": "...", "sha256": "...", "size": 0 },
  "install": { "layout": "prefix", "executables": ["bin/python3"] },
  "env": { "PYTHONHOME": "{{prefix}}", "PATH": "{{prefix}}/bin:/system/bin" },
  "healthCheck": { "cmd": ["bin/python3", "-c", "import sys;print(sys.version)"], "timeoutMs": 15000 },
  "limitations": ["no native extensions unless a wheel is published"]
}
```

### 7.3 Bootstrap contents (system-shell track)
Not a full userspace. Provided by Android: `/system/bin/sh`, toybox (`ls cat cp mv rm mkdir find grep sed awk tar gzip unzip xxd`…), `linker64`.
Shipped by us: CPython, pip, `setuptools`/`wheel`, `ca-certificates` (as a PEM bundle + `SSL_CERT_FILE`), `terminfo` subset.
Environment: `HOME=$files/home`, `TMPDIR=$cache/tmp`, `XDG_*`, `PYTHONHOME`, `SSL_CERT_FILE`, `TERM=xterm-256color`.

### 7.4 Integrity
- Manifests signed with an offline Ed25519 key; public key embedded in the APK; rotation plan documented.
- Monotonic version counters reject rollback.
- Download to staging → verify hash + signature **before** extraction → extract to staging → atomic rename → health check → keep previous version until pass.
- Safe extraction: reject `..`, absolute paths, escaping symlinks/hardlinks, device files, setuid/setgid; cap size, file count, compression ratio; pre-check free space.
- Resume interrupted downloads; clean partial installs on start.

### 7.5 Process supervision
- `setsid()` per session, kill the process group (SIGTERM → SIGKILL).
- Best-effort limits: `setrlimit`, output-rate watchdog, memory watchdog, max concurrent processes.
- Persist session metadata; reap orphans on restart.
- Scrub child environment: no tokens, no bridge handles.

---

## 8. Local web preview (post-Node)
Bind dev servers to `127.0.0.1` only, random port, per-session token, strict `Host`/`Origin`. Separate WebView with no bridge, no file access, no universal access, per-project storage partition. Foreground service while serving. Define behaviour on background, process death and network change. No promise of indefinite background servers.

---

## 9. Security and threat model

**Assets:** SSH private keys, HTTPS tokens, project source, runtime integrity, user device.

**Threats:** malicious repo (hooks, `setup.py`, npm scripts), malicious package, malicious preview content, compromised update host, other apps on device, malicious imported file/intent, terminal escape attacks, shared-UID snooping.

- **D-008 (shared UID):** all executed code runs as LeoCode's UID and can read `/data/data/dev.leocode/`. Mitigations: keys encrypted at rest, decrypted only into memory for the duration of an auth operation, never written decrypted; per-project workspace encryption optional; a clear warning in onboarding; no secrets in environment variables passed to children; **never** store tokens in files a project can read.
- Trust prompt (per project, remembered by a hash of relevant files) before: running scripts, `pip install`, `npm` lifecycle scripts, venv activation, Git hooks, auto-run tasks.
- Bridge: origin allowlist, schema validation, command allowlist (no generic exec, no arbitrary path API), canonicalised path jail inside the workspace root (after symlink resolution), no secrets across the bridge.
- WebView: file/content/universal access off, HTTPS only, debugging off in release, strict CSP, no `addJavascriptInterface`.
- Terminal: OSC 52 clipboard writes disabled, answerback disabled, titles sanitised, output rendered by xterm.js only (never injected into React).
- Android: `debuggable=false`, `allowBackup=false`, minimal `exported` components, validated `FileProvider` paths, no world-readable files.
- Supply chain: signed manifests, pinned CI actions, protected signing environment, SBOM.
- Future-proofing: build native code 16 KB-page compatible.

---

## 10. Bridge contract

Versioned (`v1`), typed, asynchronous. Full spec in `docs/bridge-contract.md`.

- Transport: `WebViewCompat.addWebMessageListener`, allowed origin = the app's `WebViewAssetLoader` origin only.
- Envelope: `{ v: 1, id, method | event, payload }`. Every request gets exactly one `ok`/`err` reply; long operations emit `event` frames keyed by `id`.
- Kotlin models are `@Serializable`; **TS types are generated** from them (`./gradlew :app:generateBridgeTypes`) so the contract cannot drift.
- Methods (v1): `workspace.*`, `fs.*` (jailed), `editor.*` (save/atomic), `proc.*`, `term.*` (open/write/resize/close), `git.*`, `ssh.*`, `runtime.*`, `app.info`.
- Errors: stable codes (`E_PATH_OUTSIDE_ROOT`, `E_NO_RUNTIME`, `E_AUTH`, `E_HOSTKEY_CHANGED`, `E_LIMIT`, `E_INTERNAL`) plus a human message.
- Limits: max message size 256 KB; terminal output coalesced at 16 ms; backpressure via `term.ack`.

---

## 11. UX specification (summary)

Full spec in `docs/ux-spec.md`.

- Portrait-first. Persistent bottom bar: **Files · Editor · Terminal · Git · More**.
- Editor: tab strip (scrollable, dirty dot), breadcrumb, gutter line numbers, find/replace sheet, and a keyboard accessory row (`Tab`, `Ctrl`, `Esc`, `← ↑ ↓ →`, `{ }`, `"`).
- Terminal: full-height sheet above the keyboard via `visualViewport`; extra-keys row; long-press to select, copy/paste via system menu only.
- Files: tree with swipe-to-rename/delete, long-press to move, pull-to-refresh; hidden files toggle; search icon.
- Git: status list with per-file diff, stage/unstage by swipe, commit box pinned to the bottom, branch chip in the toolbar.
- Runtime banner: "Python not installed — Install (142 MB)" with resumable progress.
- Onboarding: storage permission-free copy-in model explained, MIUI battery/autostart steps, trust model warning (D-008).
- Accessibility: min 48 dp targets, font scaling honoured, content descriptions on all icons.
- Performance budget: cold start < 2.5 s, keystroke-to-glyph < 50 ms on 4 GB device, editor memory < 120 MB, terminal scrollback cap 5 000 lines.

---

## 12. Distribution, updates, licensing

- Signed APKs on GitHub Releases. F-Droid later **only if** the whole app is FOSS and builds reproducibly.
- One release key; back it up; losing it blocks in-place updates.
- Self-update: signed release manifest → HTTPS download → verify APK signature matches the installed app → hand to the system installer. Needs `REQUEST_INSTALL_PACKAGES`; document MIUI's scanner prompt. Never silent.
- Runtime packages update independently of the APK.
- Licensing: Termux components **GPLv3** (avoided by D-004); git GPLv2 (not shipped on the MVP path); CPython PSF; JGit EDL/BSD; MINA SSHD Apache-2.0; Bouncy Castle MIT; xterm.js MIT; CodeMirror MIT. If Track C1 ships GPL binaries, they are separate executables with a written source offer.

---

## 13. Development workflow and CI

1. Web UI develops in the browser with a **mock bridge** (`web/src/bridge/mock.ts`); on-device testing is mandatory for bridge, IME, terminal.
2. `android/` builds with Gradle; `web/` with Vite; CI assembles both.
3. CI jobs: `web` (typecheck, build, unit tests), `android` (assembleDebug, lint), `python-runtime` (NDK build, wheel build, manifest signing — stubbed until 0C), `release` (signed APK on tag).
4. Rules: repo private until launch; never expose release keys to fork PRs (protected environment); pin actions to SHAs; `npm ci`; dependency alerts; SBOM per release; reproducible runtime builds with recorded hashes.
5. `adb install -r`, `adb logcat`, `adb shell dumpsys webviewupdate` for triage.

---

## 14. Plan B — decision tree

Run this only if a Phase-0 exit criterion fails.

```
0B exec fails on Android 9?         → hardware/SELinux issue → try alternative device; if all fail, stop (product impossible).
0B exec fails only on 11/14?        → keep targetSdk 28 and accept device matrix limits, or move to remote execution (B4).
0A WebView < 100 and not updatable? → degraded mode (§6). If both editor and bridge degrade, product is not viable → B4.
0C C2 (CPython) fails?              → B2 (userspace rebuild) → if that fails too, B3.
0C C1 too expensive?                → stay on C2, publish a restricted compatibility matrix.
0D/Git or SSH blocked?              → JGit+MINA is pure Java; failure here means a design bug, not a platform limit.
0E terminal fails?                  → if GPL acceptable: Termux terminal libs. Else: line-mode command runner + "open in Termux".
```

| Option | Product | Cost | Trade |
|---|---|---|---|
| B1 | **LeoCode + Termux backend** via `RUN_COMMAND` intent | 8–12 weeks to MVP | Non-interactive terminal; requires Termux installed; zero runtime packaging, zero W^X exposure, works on all Android versions. Best de-risking option and a legitimate v1. |
| B2 | Full userspace rebuild (Track C1) | +3–5 weeks, ongoing | Broad `pip`/npm compatibility; permanent maintenance burden. |
| B3 | Embedded interpreter (Chaquopy-style) | 2–3 weeks | No runtime installs; no arbitrary `pip`; product becomes "run this project" not "a dev environment". |
| B4 | Remote workspace over SSH | 4–6 weeks | No local execution; likely blocked by Play if marketed as an IDE shell. |

---

## 15. Schedule (full-time, one developer, AI-assisted)

| Phase | Estimate | Notes |
|---|---|---|
| Gate 0 + scaffold | 1–2 days | this commit |
| 0A device/build env | 2–3 days | gated on hardware access |
| 0B process execution | 3–5 days | parallel with 0A |
| 0C2 CPython + pip + venv | 2–3 weeks | CI-heavy; largest single item |
| 0D Git/SSH | 3–4 days | JGit/MINA only |
| 0E PTY/terminal | 1–2 weeks | xterm.js mobile tuning |
| 0F cross-device | 3–5 days | needs Android 14+ device |
| **Phase 0 total** | **4–6 weeks** | |
| Phase 1 shell/workspace | 2–3 weeks | |
| Phase 2 editor/terminal | 3–4 weeks | |
| Phase 3 Git/SSH UI | 2–3 weeks | |
| Phase 4 Python manager | 2–3 weeks | |
| Hardening + beta | 3–4 weeks | |
| **MVP total** | **17–24 weeks** | ~4–6 months |
| Track C1 (optional) | +3–5 weeks | only if broad `pip` is required |

If B1 (Termux backend) is taken for v1: **8–12 weeks** total.

---

## 16. Definition of done (0.1)

A user can: create/open/export a workspace; browse and edit Python with syntax highlighting without losing work after a crash; use the terminal; install/run Python; use pip and a venv; clone via SSH and HTTPS and run basic Git; authenticate without exposing keys; see useful errors; close and reopen without corrupting state.

Node.js, Java, PHP and preview are out of 0.1.

---

## 17. Immediate next actions

1. ~~Fix package ID, distribution, targetSdk; record decisions.~~ **Done (v8).**
2. ~~Scaffold repo, CI, plan, progress tracker.~~ **Done.**
3. Connect the Redmi (USB debugging + MIUI toggles) and run 0A.
4. Run 0B on both phones; record the matrix.
5. Start 0C2: CI job that builds CPython for `android-aarch64`.
6. Secure an Android 14+ device before freezing Phase 0.
7. Only then: Phase 1 UI.
