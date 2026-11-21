# LeoCode — Decision Records

Aggregated record of the frozen decisions. Each entry: context → decision → alternatives → trigger to reopen.

---

## D-001 — Distribution: direct APK, no Google Play

**Context** LeoCode downloads and executes interpreters and package-manager content. Play policies restrict downloaded executable code and impose target-API floors.
**Decision** Distribute signed APKs via GitHub Releases. F-Droid only if the app is fully FOSS and reproducible.
**Alternatives** Play Store (rejected: incompatible), F-Droid-only (rejected: excludes closed-source options).
**Reopen if** the project becomes fully FOSS and F-Droid inclusion is worth the build constraints.

## D-002 — targetSdk 28, compileSdk 34, minSdk 28

**Context** API 29+ blocks `execve()` of app-written files, which kills local runtimes.
**Decision** targetSdk 28 (Termux's approach). compileSdk 34 for modern tooling. minSdk 28 to match the tested floor.
**Alternatives** targetSdk 34 (rejected: no local execution), shipping executables as `lib*.so` in `nativeLibraryDir` (partial workaround: works for the interpreter, not for `dlopen` of venv `.so` files).
**Reopen if** Android's install floor reaches 29, or a workaround makes targetSdk 34 viable. See plan §14 (plan B).

## D-003 — Package ID `dev.leocode`

**Context** The app's data path becomes the runtime prefix and appears in shebangs. Changing it invalidates every built package and the key store.
**Decision** `dev.leocode` → prefix `/data/data/dev.leocode/files/usr` (33 chars).
**Alternatives** `com.leocode.ide` (longer), `io.leo` (risk of domain collision).
**Reopen never.** Treat as final.

## D-004 — Terminal: xterm.js over our own JNI PTY

**Context** Termux `terminal-view`/`terminal-emulator` are GPLv3 and are linked into the APK, so the "separate process" mitigation does not apply.
**Decision** xterm.js in the IDE WebView, attached to our own `openpty`/`fork`/`setsid` JNI layer. No GPL code.
**Alternatives** GPLv3 the whole app and use Termux views (better native IME, but forces GPL); write a clean-room native view (3–5 weeks).
**Reopen if** xterm.js fails the 0E IME/layout criteria **and** the app is going GPLv3, or if a clean-room native view becomes worth the time.

## D-005 — Git/SSH: JGit + MINA SSHD + Bouncy Castle

**Context** JGit and MINA SSHD are pure Java, so Git works with no runtime installed and no native binaries.
**Decision** In-process JGit for Git, MINA SSHD for SSH, Bouncy Castle for Ed25519/Curve25519 on API < 33.
**Alternatives** Native git/OpenSSH from a userspace (deferred to Track C1), libgit2 via JNI (unnecessary).
**Reopen if** JGit blocks a required workflow (hooks, LFS, complex submodules) and a userspace exists.

## D-006 — Python: two tracks, C2 first

**Context** No official CPython for Android/bionic. Full userspace rebuild is 3–5 weeks plus maintenance.
**Decision** MVP uses the system shell (`/system/bin/sh` + toybox) with a CPython built by us using the NDK, plus our own wheel index for native extensions (**Track C2**). A Termux-style userspace rebuild (**Track C1**) is optional and only if broad `pip`/npm compatibility is required.
**Alternatives** Full userspace first (rejected: too slow to validate the product), Chaquopy (rejected: build-time only).
**Reopen if** device tests show the system shell is unusable, or users need packages we cannot wheel.
**Amended by D-012 (2026-11-11):** the CPython itself now comes from the official python.org Android build instead of our own NDK build of the interpreter. The two-track structure and the C1 deferral are unchanged.

## D-007 — WebView minimum: Chromium 100

**Context** `addWebMessageListener` needs WebView 88+; CodeMirror 6 needs ~87+. The secure bridge design depends on the former.
**Decision** Chromium 100+ is a hard Phase-0A gate. Degraded mode: textarea+Prism editor and an intercepted-request bridge for devices that cannot update.
**Alternatives** `addJavascriptInterface` (rejected: cannot be origin-restricted), GeckoView (heavy, different engine).
**Reopen if** the target devices cannot reach 100 and degraded mode is unacceptable → GeckoView evaluation.

## D-008 — Shared-UID execution model

**Context** Unrooted Android gives no way to run project code under a different UID.
**Decision** Accept it, document it, and minimise exposure: keys encrypted at rest, decrypted only in memory for the duration of an operation, no secrets in child environments, onboarding warning that a malicious project can read other projects.
**Alternatives** Separate helper app with `sharedUserId` (deprecated and still same data dir access), per-project encryption (optional, does not stop same-UID reads while mounted).
**Reopen if** a sandboxing primitive becomes available unrooted.

## D-009 — Secrets: Keystore envelope encryption

**Context** Keystore cannot hold arbitrary OpenSSH/Ed25519 keys directly.
**Decision** A non-exportable AES-GCM key in the Keystore wraps key material stored as an encrypted blob in app-private storage. StrongBox when available. No plaintext key files.
**Alternatives** Storing keys directly in Keystore (not possible), plain files (rejected).
**Reopen if** biometric/device-credential gating is requested for key use.

## D-010 — Preview isolation

**Context** Dev servers and preview content are untrusted.
**Decision** Bind `127.0.0.1` only, random port, per-session token, strict `Host`/`Origin`; separate WebView with no bridge, no file access, own storage partition.
**Alternatives** Same WebView with CSP (rejected).
**Reopen if** preview needs to call IDE APIs — it must not.

---

Decisions added by plan v9 (2026-11-11).

## D-011 — Optional root mode

**Context** Users run LeoCode on rooted and unrooted phones. Root can make terminal work more useful (system inspection, disabling the phantom-process monitor), but a prompt at startup or root-wide file access would surprise unrooted users and widen the attack surface.
**Decision** Root is opt-in from Settings › Advanced › Root mode. Detection only checks for an `su` binary and never prompts. Enabling shows a warning sheet, then requests the grant through [libsu](https://github.com/topjohnwu/libsu) `core` (Apache-2.0). Root features: a root terminal session (PTY running `su`) and a "Run as root" toggle (`su -c` with argv quoting). A ROOT badge is shown while root processes are alive. Because the app UID cannot signal root processes, cancel kills the recorded process group through `su`. The bridge path jail stays: no file API accepts root paths. Lost grants end sessions with `E_ROOT_DENIED`.
**Alternatives** No root support (rejected: user requirement); root file browsing via libsu `nio` (rejected for 0.1: breaks the path-jail model); raw `Runtime.exec("su")` without a library (rejected: fragile across Magisk/KernelSU/ROM `su` variants).
**Reopen if** users need root file browsing, or a ROM's `su` breaks libsu.

## D-012 — CPython from the official python.org Android build

**Context** CPython supports Android as a tier-3 platform (PEP 738) and python.org publishes Android builds designed for embedding (`libpython3.x.so` + stdlib). cibuildwheel can build Android wheels. Maintaining our own OpenSSL/libffi/expat/CPython cross-build (`scripts/build-python.sh`) costs time we do not need to spend.
**Decision** CI downloads the official `aarch64` Android build (pinned version + sha256), adds a small NDK-built `python3` launcher calling `Py_BytesMain`, the certifi CA bundle and pip, checks 16 KB alignment, and publishes a signed package. Native wheels come from cibuildwheel. The prefix is computed from `filesDir` at runtime. `scripts/build-python.sh` is retired in Task 24. Amends D-006.
**Alternatives** Keep the custom build (rejected: more maintenance, older 3.11); Chaquopy (rejected: build-time only); Termux packages (rejected: GPL prefix/userspace track, C1).
**Reopen if** the official build cannot run as a standalone interpreter, lacks a needed module, or its libraries are not 16 KB aligned.

## D-013 — Local-only diagnostics

**Context** Production needs crash visibility, but uploading data needs a server, a privacy policy and consent flows.
**Decision** Crashes are written to a local `CrashStore`. The next launch opens a native `RecoveryActivity` (Restart, Share diagnostics). Settings › About › Diagnostics offers Copy/Share. All output passes through `Redactor` (no tokens, keys, env values, or paths outside allowed roots). No network upload.
**Alternatives** Opt-in upload to a crash service such as self-hosted Sentry (rejected for 0.1: server + privacy work); no crash reporting (rejected: unsupportable).
**Reopen if** the user base grows beyond what manual reports can cover.

## D-014 — Device matrix: two real phones, no emulators

**Context** The laptop cannot run emulators. Two phones are available, with one USB cable. The Android 11 and stock Android 14+ phones from v8 are not available.
**Decision** D1: Redmi Note 7S, Android 9, unrooted, MIUI (Wi-Fi ADB). D2: custom ROM, Android 15, rooted, no device integrity (USB). Unrooted Android 15 is approximated by denying `su` to LeoCode on D2. Android 10–14 are documented as unverified on hardware. Heavy builds run on GitHub Actions.
**Alternatives** Emulators (rejected: hardware); cloud device farms (rejected for now: cost, and unrooted only).
**Reopen if** another phone becomes available (add it as a column) or a user reports a 10–14-specific failure.

## D-015 — Manual DI and Zustand

**Context** `WebAppBridge.kt` (728 lines) and `App.tsx` `Shell` (≈ 970 lines) hold most of the logic. The app needs clear ownership without slowing builds on a weak laptop.
**Decision** Android: an `AppGraph` built once in `LeoApp` constructs every service (≈ 15); handlers and Activities receive dependencies. Web: Zustand feature stores replace `Shell`'s local state.
**Alternatives** Hilt/Dagger (rejected: annotation processing cost, little gain at this size); Koin (acceptable, but another runtime dependency); Redux Toolkit (rejected: more boilerplate than needed); React context only (rejected: re-render churn in the editor).
**Reopen if** the service count passes ~40 or tests need scoped graphs that manual wiring makes awkward.

## D-016 — JGit 5.13.3.202401111512-r

**Context** JGit 6.x is compiled for Java 11 and uses library APIs that do not exist on Android API 28 without core-library desugaring (for example `List.of`, `Map.of`, `InputStream.readAllBytes`, `String.isBlank`). LeoCode has minSdk 28 (D-002), no desugaring configured, and D1 — the only API 28 device — was offline during the Task 19 spike, so the 6.x branch could not be proven safe on the oldest supported device. JGit 5.13.x targets Java 8 and is the plan's documented fallback. D1 became available on 2026-11-21 and passed T10–T14 with the pinned 5.13.3 set; 6.x remains unretested.
**Decision** Pin `org.eclipse.jgit:org.eclipse.jgit:5.13.3.202401111512-r` and `org.eclipse.jgit:org.eclipse.jgit.ssh.apache:5.13.3.202401111512-r`, with `org.apache.sshd:sshd-core:2.13.2`, `org.bouncycastle:bcprov-jdk18on:1.78.1` and `org.bouncycastle:bcpkix-jdk18on:1.78.1`. The Android app remains on targetSdk 28 / minSdk 28 with no desugaring. If 5.13.3 + SSHD 2.13.2 fails at runtime, pin SSHD to the version named by the JGit 5.13.3 POM rather than upgrading JGit.
**Status** Settled for 5.13.3. D1 (Android 9 / API 28) and D2 (Android 15) both pass T10–T14, including HTTPS clone, SSH clone, push and pull; see `docs/reports/phase-f-verification.md` and `docs/device-reports/20261121-131954-phaseF-D1-11f98015.txt`.
**Alternatives** JGit 6.x (rejected for this pass: unproven Java 11 API use on API 28; keep as the re-test target); libgit2 via JNI (rejected: native code and licensing work); native git from a userspace (deferred with Track C1); enabling core-library desugaring just for JGit (rejected: APK size and a global toolchain change for one dependency).
**Reopen if** D1 is available to prove a 6.x line on API 28 before a major bump, or 5.13.x blocks a required workflow (hooks, LFS, complex submodules). Re-test 6.x on D1 before every future major JGit bump; the spike must cover HTTPS clone, SSH clone and push (T10–T13).

## D-017 — Python is the primary language

**Context** LeoCode exists to write and run code on a phone. Spreading effort across Python, Node.js, Java and PHP at once would leave none of them usable. Python is already the first runtime in the plan (D-006, D-012) and has the lowest packaging risk because an official Android build exists.
**Decision** Python is supported first and supported well, defined by the acceptance suite in plan v9 §9.1 (install, run with `input()`, tappable tracebacks, REPL, pip and per-project venv, Python-aware editor, project template). Python tasks (24–26, 30–33) are built right after the web restructure, before workspaces, Git/SSH and root mode. Other languages are added later through a `LanguageProvider` interface (Task 30); nothing outside the provider hard-codes `python`.
**Alternatives** Several languages shallowly in parallel (rejected: none usable); Python after Git (rejected: the product is not a coding tool until code runs); Python hard-coded without an interface (rejected: forces a rewrite for the second language).
**Reopen if** Python cannot meet §9.1 on both devices (see the plan-B tree), or a different language becomes the product's main audience.
