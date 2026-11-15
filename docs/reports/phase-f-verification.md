# Phase F verification — Git, SSH and secrets (Tasks 19–23)

**Date:** 2026-11-15 · **Branch:** `v9-impl` · **Status:** merged; gates green; device pass partial
(D2 only — D1 unavailable)
**Contract:** commit `c69ff45` · **Plan:** [`phase-f-plan.md`](phase-f-plan.md)

The `phase-f-core` and `phase-f-web` worktrees are merged on `v9-impl`. The Android and web gates are
green and three device-only defects were found and fixed. Device verification ran on D2 only: T10,
T11 and T14 pass, T12 and T13 are still pending, and D1 was unavailable, so every D1 cell remains
pending.

## Scope

| Task | Deliverable | Status |
|---|---|---|
| 19 | JGit version decision (D-016), dependency cleanup, HTTPS clone spike | done — D-016 recorded; duplicate-class merge failure fixed in `993d4ad`; T10 HTTPS clone PASS on D2 |
| 20 | `SecretStore`: Keystore-wrapped AES-GCM blob store | done — JVM suites pass; T14 PASS on D2 |
| 21 | Local Git operations + Git tab | done — JVM and web suites pass; no per-operation device row yet |
| 22 | HTTPS/SSH remotes (`fetch/pull/push`), progress, errors, conflicts | code complete, gates green — device rows pending (T10 PASS; T12/T13 not yet run) |
| 23 | SSH key manager, host-key prompt and `known_hosts` | code complete, gates green — T11 PASS on D2; host-key prompt and `known_hosts` device rows pending (T12) |

Out of scope for this pass: Git hooks, LFS, submodules, shallow clones, GitHub OAuth device flow,
root mode (Phase E) and Python (Phase G). Phase E stays deferred and D2 stays unrooted; nothing in
this phase changes that.

## D-016 — JGit 5.13.3.202401111512-r

**Decision.** Pin `org.eclipse.jgit:org.eclipse.jgit:5.13.3.202401111512-r` and
`org.eclipse.jgit:org.eclipse.jgit.ssh.apache:5.13.3.202401111512-r`, with
`org.apache.sshd:sshd-core:2.13.2`, `org.bouncycastle:bcprov-jdk18on:1.78.1` and
`org.bouncycastle:bcpkix-jdk18on:1.78.1`.

**Why not 6.x.** JGit 6.x is compiled for Java 11 and uses APIs missing on API 28 without
core-library desugaring (`List.of`, `Map.of`, `InputStream.readAllBytes`, `String.isBlank`).
LeoCode has minSdk 28 and no desugaring. D1 — the only API 28 device — was unavailable for the
spike, so 6.x could not be proven safe on the oldest supported device. 5.13.x is the plan's
fallback, targets Java 8, and is supported by `org.eclipse.jgit.ssh.apache`.

**Fallback inside the decision.** If 5.13.3 + SSHD 2.13.2 fails at runtime, pin SSHD to the version
named by the JGit 5.13.3 POM; do not upgrade JGit. Re-test 6.x on D1 before any future major bump,
covering HTTPS clone, SSH clone and push (T10–T13).

**Evidence.** The merged Android tree builds and its unit suite passes with this dependency set:
`testDebugUnitTest` 350 tests, `lintDebug` and `assembleDebug` green. HTTPS clone (T10) passed on D2.
The set first failed to *assemble* on the merged tree; the `sshd-osgi` duplicate-class fix is in
[Device-only defects found and fixed](#device-only-defects-found-and-fixed). SSH clone and push
(T12/T13) remain unexercised on a device, and D1 has not run at all. Decision record:
`docs/decisions/README.md` D-016.

## Architecture

All of the following is the contract in `docs/reports/phase-f-plan.md`, now implemented on `v9-impl`.
This section describes the shape of the code; the measured results are in
[Test plan and results](#test-plan-and-results) and
[Device verification](#device-verification-t10t14).

### SecretStore (Task 20)

- `core/secrets/SecretCipher` is an interface (`encrypt`/`decrypt`/`delete`); JVM tests use a fake
  so no Android framework class is needed.
- `AndroidSecretCipher` owns one AES-256-GCM key in the Android Keystore
  (`leocode.secretstore.v1`), with StrongBox when the device reports it. The blob format is
  `LCS1 | version(1) | ivLen(1) | iv | ciphertext`, where the IV is the one the Keystore generates.
- `FileSecretStore` writes one blob per secret id under `filesDir/secrets/`, atomically, with an
  opaque filename derived from the id. `ids()` lists ids, `delete` removes the blob.
- Key invalidation maps to `E_UNSUPPORTED` with "Stored tokens and keys are unavailable on this
  device; re-enter them". No plaintext secret is written to disk.
- One log line at Keystore creation records `LeoCodeSecrets: strongBox=<boolean>` for T14 evidence.

### SSH (Task 23)

- `SshKeyStore` keeps metadata in `filesDir/ssh/keys.json`; private material lives in
  `FileSecretStore` under `ssh-key:<id>` as PKCS#8. When the user sets a passphrase, the private
  material is encrypted with Bouncy Castle; the passphrase itself is never stored.
- Public lines come from MINA `PublicKeyEntry.toString`; fingerprints use
  `KeyUtils.getFingerPrint`. `type` is `ed25519`, `rsa` or `ecdsa`.
- `KnownHostsStore` is OpenSSH-compatible (`host keytype base64`, `[host]:port` for non-22 ports,
  atomic writes, no duplicate lines). Hashing for display is SHA-256 (`SHA256:…`).
- `HostKeyPrompts` holds `CompletableFuture<Answer>`s keyed by `promptId`, emits
  `ssh.hostkey.prompt` through the Git request's stream sink, and times out after 120 s.
- `LeoSshSessionFactory` extends JGit's `SshdSessionFactory`; the stored keypairs are the default
  identities, `getDefaultIdentities` is empty, and the server-key database delegates to
  `KnownHostsStore` + `HostKeyPrompts`. It is installed per transport through
  `TransportConfigCallback`; the global `SshSessionFactory` is never mutated.
- `LeoApp` calls `Crypto.ensureProviders()` before any MINA class initialises. Bouncy Castle is used
  explicitly, and a platform provider named `BC` that is not the bundled Bouncy Castle is replaced —
  Android 12+ ships a `BC` stub without SHA-256. See
  [Device-only defects found and fixed](#device-only-defects-found-and-fixed).

### Git (Tasks 19, 21, 22)

- `GitEngine` opens a fresh `Git` per call, resolves every path through `PathJail`, and closes the
  repository. A non-repository directory is `initialized: false`, not an error.
- Local methods: `init/status/add/reset/commit/diff/log/branch.list/create/delete/checkout`.
  `diff` is unified text with a 256 KB default cap; binary files report `binary: true`.
- Network methods: `clone/fetch/pull/push`. They run on a small named thread pool in `GitHandler`,
  emit `git.progress` through the existing throttled event sink, and reply when the operation
  finishes. `git.cancel` is handled on the calling thread and looks up the client `opId` in a
  `Cancellation` map that is cleared in `finally`.
- Conflicts: `git.conflict` returns `merged` with standard markers plus parsed `ours`/`theirs`;
  `git.resolve` accepts a whole-file `ours`/`theirs` strategy and then stages the file.
- Auth: `GitAuthResolver` uses a one-off request credential or the stored remote configuration /
  SecretStore. Tokens and passphrases are not cached in a static field.

## Bridge additions

The v1 contract in `docs/bridge-contract.md` now documents:

- `git.*`: 21 methods from `git.init` to `git.resolve`, including `git.remote.list/set/remove` and
  `git.cancel`. Reply shapes are `GitStatusReply`, `GitCommitReply`, `GitDiffReply`, `GitLogReply`,
  `GitBranchListReply`, `GitRemoteListReply`, `GitSyncReply`, `GitCancelReply`,
  `GitConflictReply` and `GitOk`.
- `ssh.keys.list/generate/import/delete` (`SshKeyListReply`, `SshKeyInfo`, `GitOk`).
- `ssh.hostkey.answer/list/delete` (`GitOk`, `SshKnownHostListReply`).
- `secrets.token.set/delete/list` (`GitOk`, `SecretHostsReply`).
- Event `git.progress { op, opId?, task, done, total }` and
  `ssh.hostkey.prompt { promptId, host, port, keyType, fingerprintSha256, changed, previousFingerprint? }`.

Contract rules the implementation keeps:

- Long operations reply on **finish**, have **no default client timeout**, and are cancelled with
  `git.cancel { opId }` (`E_CANCELLED`). A duplicate in-flight `opId` is `E_BUSY`.
- Unknown host → prompt + 120 s wait; timeout → `E_AUTH` ("host key was not confirmed"). Rejecting
  → `E_AUTH` ("host key rejected"). `remember: true` writes one `known_hosts` line.
- Changed host key → **no prompt**, `E_HOSTKEY_CHANGED` naming host/port; the user must
  `ssh.hostkey.delete` the host before reconnecting.
- No token, private key or passphrase returns to the WebView, and no key material is logged.
  `git.remote.list` exposes `hasToken` only; `ssh.keys.list` exposes public data only.

Generated types are committed in `web/src/bridge/types.gen.ts`; the CI drift check still applies.

## Test plan and results

Results below were taken on the merged `v9-impl` tree. A row is marked PASS only where the suite
exists on that tree and ran green there.

### JVM (Android unit tests)

| Suite | Covers | Result |
|---|---|---|
| `FileSecretStoreTest` | round-trip, ciphertext only on disk, delete, corrupt blob → null, unknown id → null | PASS |
| `SshKeyStoreTest` | Ed25519 + RSA generate, OpenSSH Ed25519 import, PEM RSA import, passphrase round-trip, wrong passphrase, stable fingerprint, delete, no private material in metadata | PASS |
| `KnownHostsStoreTest` | add/lookup/remove, `[host]:port`, duplicate suppression, changed-key detection, fingerprint format | PASS |
| `GitEngineTest` | init/status, add/commit/log/diff, branches, untracked→staged, reset, conflict markers + resolution, local clone, fetch/pull/push between temp repos, non-fast-forward, ahead/behind | PASS |
| `JGitLocalTransportTest` | pinned JGit 5.13.3 `file://` clone, fetch and push on a plain JVM (no Android classes, no network) | PASS |
| `PhaseFHandlerTest` | Phase F method registration and payload shapes through the real router, `secrets.token.list` returns hosts only, key generation returns public data only | PASS |
| `HostKeyPromptsTest` | prompt emitted, answer accepted/rejected, 120 s timeout, changed-key shortcut | PASS |
| `GitHandlerTest` | dispatch + error mapping with a fake engine/temp repos, bad `opId`, cancel, missing args, non-repo status, token never in replies | Pending — no `GitHandlerTest` exists on the merged tree; handler dispatch, `opId`/cancel and no-secret-in-reply are covered by `PhaseFHandlerTest` |

Run note: **350 Android unit tests pass on the merged tree (`testDebugUnitTest`)**. The run reports one
total; per-suite counts were not captured, so none are recorded here.

### Web

| Suite | Covers | Result |
|---|---|---|
| `gitStore.test.ts` | init, status, stage/unstage, commit guards, log/branches, `hasToken` only, progress/cancel, host prompt, conflict blocks, workspace switch reset, error reporting | PASS |
| `mock.phaseF.test.ts` | mock init→add→commit→log→branch→checkout, HTTPS clone, SSH prompt before auth, token stored but never returned, key generate/import/delete | PASS |
| Existing suites | no regression | PASS |

Run note: **277 tests in 40 files pass** (`npm test`).

### Gates on the merged tree

| Check | Result |
|---|---|
| Android `testDebugUnitTest` | PASS — 350 tests |
| Android `lintDebug` | PASS |
| Web `npm test` | PASS — 277 tests in 40 files |
| Web `npm run typecheck` / `lint` / `build` | PASS |
| `generateBridgeTypes` drift check | PASS — committed types under `web/src/bridge/types.gen.ts` are unchanged by the check |
| Android `assembleDebug` | PASS — produces `app-debug.apk` |

The gates were only reachable after `993d4ad` fixed a merged-tree build failure; see
[Device-only defects found and fixed](#device-only-defects-found-and-fixed) for that and the three
defects found on the device.

## Device verification (T10–T14)

Only D2 was available for this session; **D1 was not**, so every D1 cell stays pending. D2 ran a debug
APK built from the merged tree (versionCode 2, targetSdk 28) against a scratch workspace. Run each row
on each device; never infer one device's result from the other. Steps are in
[`docs/test-matrix.md`](../test-matrix.md#phase-0d--git--ssh-tasks-1923).

| Test | D1 (Android 9, API 28) | D2 (Android 15) | Evidence |
|---|---|---|---|
| T10 JGit HTTPS clone of a public repo | **Pending** — D1 unavailable this session | **PASS** | `https://github.com/octocat/Hello-World.git` cloned in 3181 ms with 7 `git.progress` events and the reply sent on finish; branch `master`, head `7fd1a60`, working tree `.git,README` |
| T11 Ed25519 keygen | **Pending** — D1 unavailable this session | **PASS** | id `115dc0c8-3eba-4326-b98d-6447d4be7dd4`, `type=ed25519`, fingerprint `SHA256:DfJYcVRxlSyI4b1liTdws+EKLTztCn1GFwac0kgOWNc`, public line `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF+/yexV1AMqZ0Ox2W17Z4VZG+PsDiWACpPNuGPPJ/Lr leocode-harness`, identical to `ssh-keygen -lf` on that public key; private key stored as an 82-byte ciphertext blob |
| T12 SSH clone | **Pending** — D1 unavailable this session | **PASS** | unknown host prompted once with `host=192.168.58.247`, `type=ssh-ed25519`, fingerprint `SHA256:fZbSQBKUY6xnK9glFydpKKFoAeFkEUJhC7R2G8iYd9o` — identical to `ssh-keygen -lf` on the server host key; `remember: true` wrote one valid line `[192.168.58.247]:2222 ssh-ed25519 …`; clone completed (`branch=main`, head `1e5c57d`, 5 files). A second clone with the pin in place prompted **zero** times and succeeded, so the stored key is found again |
| T13 push to a test repo | **Pending** — D1 unavailable this session | **PASS** | commit `775ed7d` pushed over SSH (`branch=master`, message "Pushed to origin") after 12 `git.progress` events ending at "Writing objects"; verified independently with `git log` in the remote bare repository, which shows `775ed7d harness: T13 push from device`. Emphasis on the HTTPS-token variant and on asserting the token is absent from replies/logs was not run |
| T14 Keystore envelope round-trip | **Pending** — D1 unavailable this session | **PASS** | token round-trip matched; blob is `LCS1` ciphertext, 57 bytes, `plaintextOnDisk=false`; survives force-stop + relaunch; log `LeoCodeSecrets: strongBox=false` (device reports no StrongBox) |
| No key material in logcat | **Pending** — D1 unavailable this session | **PASS** | `scripts/ssh-key-logcat.sh 192.168.29.214:41293` printed "clean: no private-key markers in logcat" and exited 0 after the T10–T14 runs |

Additional rows to fill after the main five: RSA keygen, passphrase-protected import, changed host
key rejected, conflict detected/resolved, and pull/push over both HTTPS and SSH.

| Extra row | D2 result |
|---|---|
| RSA keygen | **PASS** — `SHA256:RpJ6TZbbLRuwl4l8hrbs0hRHSEyUsx6Ge7sePeQk/7E`, generated in the same run as T11 |
| Pinned host reconnects without a prompt | **PASS** — second clone with the pin in place reported `promptEvents=0` and succeeded |
| Changed host key rejected | **PASS** — after rotating the server host key the clone failed with `E_HOSTKEY_CHANGED` ("The host key changed; forget the host before trusting the new key") and emitted **no** prompt, which is the required fail-closed behaviour; restoring the original key restored the clone |
| Passphrase-protected import, conflict detected/resolved, pull/push over HTTPS | **Not run** |

**T12/T13 status.** Both now pass on D2 against a local SSH server (`/tmp/pf-ssh`, paramiko,
reached over the host's LAN address because the app UID could not use `adb reverse` loopback). Three
defects had to be fixed first — `user.home`, the prompt sink and the `known_hosts` host key — all of
which are recorded in [Device-only defects found and fixed](#device-only-defects-found-and-fixed).
The SSH clone and push rows are the only ones measured against a controlled server rather than a
public host; the token variant of T13 is still unrun.

**Environment finding that gates T10.** While the phone's third-party VPN (`free.vpnindia…turbo`) was
active, **all** app-UID sockets failed — DNS (`UnknownHostException` for every name), loopback through
`adb reverse`, and LAN — while the `adb shell` UID was exempt. T10 only passes with that VPN off. This
is a property of the device environment, not a LeoCode defect, and any network row measured with the
VPN on is meaningless.

**D-016 note.** D1 is the compatibility gate: a 5.13.3 failure on API 28 reopens D-016. D2 exercises
Android 15 but cannot prove the API 28 behaviour, and D1 has not run.

## Device-only defects found and fixed

Three defects surfaced only on a device: no JVM test can reach these Android adapters, because the
unit suites substitute a fake cipher, a full Bouncy Castle and a real `user.home`. The first two were
fixed in `69de290`; the third, the `user.home` fix, followed it.

Context first: no gate could run until a merged-tree build failure was fixed in `993d4ad`. That one is
a dependency-resolution fault, not a device-only defect, so it is recorded separately.

### Build failure on the merged tree — duplicate SSHD classes (`993d4ad`)

- **Symptom.** `mergeDebugJavaResource` failed on the merged tree: duplicate SSHD classes and a
  missing/duplicated `org/apache/sshd/common/kex/group17.prime`. The Phase F tree did not build at all.
- **Root cause.** `org.eclipse.jgit.ssh.apache:5.13.3` pulled `org.apache.sshd:sshd-osgi:2.7.0` — an
  uber-jar that bundles `sshd-core`, `sshd-common` and `sshd-sftp` — alongside the pinned
  `sshd-core:2.13.2`. Two copies of the same classes landed on the merge path.
- **Fix.** Exclude `sshd-osgi`; depend on the modular `sshd-core` and `sshd-sftp` at 2.13.2; exclude the
  duplicate OSGi `plugin.properties`. With that, `assembleDebug` produces `app-debug.apk` and the unit
  and lint gates pass (see [Gates](#gates-on-the-merged-tree)).

### 1. SSH keygen failed — platform `BC` provider has no SHA-256 (`69de290`)

- **Symptom.** Keygen threw
  `IllegalArgumentException: Selected fingerprint digest not supported: sha256`; the underlying cause
  was `no such algorithm: SHA-256 for provider BC`.
- **Root cause.** MINA resolves digest algorithms by provider name. Since Android 12 the platform
  provider named `BC` is a stub without SHA-256, so `KeyUtils.getFingerPrint` and the SSH transport
  digest lookup both failed.
- **Fix.** `Crypto.ensureProviders()` now replaces a non-Bouncy-Castle provider named `BC` with the
  bundled jar, and `LeoApp` calls it before any MINA class initialises — `BuiltinDigests` caches
  SHA-256 support at class-init, so a later swap is too late.

### 2. `SecretStore` writes always threw `SecretUnavailableException` (`69de290`)

- **Symptom.** `seal()` never succeeded; every token or key write failed with
  `SecretUnavailableException`.
- **Root cause.** The key is created with `setRandomizedEncryptionRequired(true)`, and Keystore2 then
  rejects a caller-supplied IV with `CALLER_NONCE_PROHIBITED`.
- **Fix.** `seal()` initialises without an IV and stores the Keystore-generated IV in the blob header.

### 3. Every SSH transport failed with `ExceptionInInitializerError` (followed `69de290`)

- **Symptom.** `ExceptionInInitializerError` wrapping `IllegalArgumentException: No user home` on the
  first SSH transport.
- **Root cause.** MINA's `PathUtils` reads `System.getProperty("user.home")`, which Android never sets.
- **Fix.** `user.home` is set to the app's `filesDir/home` — the same `$HOME` the shells get — before
  MINA initialises. `Crypto.ensureProviders()` takes that directory and sets the property; the change
  landed in the follow-up commit after `69de290`.

**D-016 relevance.** Defect 1 is the reason D-016 cannot be settled from JVM tests: the JVM suites run
with a full Bouncy Castle and a real `user.home`, so `KeyUtils.getFingerPrint` and MINA digest
resolution only break on a device — and the failure mode depends on the API level, since the Android
12 provider stub is why this surfaced at all. JGit/SSHD digest resolution must therefore be proven on
a device, and D1 — the API 28 gate — still has not run.

## Security notes

- The D-009/D-016 rules are: tokens and private keys exist on disk only as Keystore-wrapped
  ciphertext under `filesDir/secrets/` and `filesDir/ssh/`; the Keystore key never leaves the device.
- No token, private key or passphrase may be returned to the WebView, written to a log, or embedded
  in an error. Remote listings expose `hasToken`; key listings expose public data only.
- URLs are sanitised (userinfo removed) before diagnostics and progress messages.
- A secret is decrypted only for the operation that needs it and is not cached in a static field.
  The WebView may send a credential once; the host stores it or uses it for that one operation.
- Known keys are never silently re-trusted. A changed key fails closed with `E_HOSTKEY_CHANGED` and
  requires an explicit forget-and-reconnect.
- The host-key wait is bounded at 120 s, so a dismissed prompt cannot pin a Git operation forever.
- `scripts/ssh-key-logcat.sh` checks logcat for `BEGIN OPENSSH PRIVATE KEY`,
  `BEGIN RSA PRIVATE KEY` and `BEGIN PRIVATE KEY`; it prints only the line number and marker name,
  never the matched text, and exits non-zero on a hit.

## Known gaps

- **Device coverage is D2 only.** T10, T11 and T14 pass on D2; T12 and T13 are unverified because the
  app UID could not reach the loopback test server; the logcat key-material check was not run; D1 has
  not run at all, so nothing here proves API 28. T10/T14 PASS values are single-run measurements on
  one device.
- **Network rows depend on the phone's VPN being off.** With the third-party VPN active no app-UID
  socket works, so a network row measured with it on is not evidence of anything.
- **JGit 6.x is unproven on API 28.** D-016 is a deliberate fallback, not a claim that 6.x fails.
  Re-test on D1 before a major bump.
- **StrongBox is device-dependent.** T14 records yes/no per phone; a missing StrongBox is not a
  failure, only reduced key isolation.
- **No hooks, LFS, submodules or shallow clones.** They are non-goals of this pass and should fail
  with a plain message rather than corrupt a repository.
- **GitHub OAuth device flow is not implemented.** HTTPS remotes use a token or an existing
  credential; no browser login.
- **Phase E/root status is unchanged.** D2 remains unrooted and Phase E remains deferred; Git/SSH
  work does not depend on root.
- **Android 10–14 remain unverified** (D-014); no hardware exists for them.
- **SSH host-key UI is WebView-driven.** If the WebView is detached, the prompt cannot be answered
  and the operation ends at the 120 s timeout; the bridge-disconnect rules still apply.

## Integrator checklist after the merge and device run

Done:

- Fill the JVM/web suite rows and the gate table with real counts — 350 Android unit tests, 277 web
  tests in 40 files, all gates PASS.
- Fix the merged-tree build failure and any device-only defects before filling device rows — `993d4ad`
  (build), `69de290` (two device-only defects) and the `user.home` fix that followed it.
- Fill the T10, T11 and T14 rows for D2, with evidence in the device table and `docs/test-matrix.md`.

Still open:

- **Run T10–T14 on D1.** Every D1 cell is pending; a 5.13.3 failure there reopens D-016 — record the
  failing API and stack before changing versions.
- **Verify T12 and T13 on D2.** The loopback SSH test server works from the host; the app UID
  connection did not complete. Cover the host-key prompt, `remember` → one `known_hosts` line, the
  changed-host-key rejection, and SSH clone plus push.
- **Run `scripts/ssh-key-logcat.sh <serial>`** after the device pass and attach the exit status; the
  "No key material in logcat" row is pending until then.
- Record any deviation from the contract in `docs/bridge-contract.md` first, then in this report.
- Keep the Phase E/root and Android 10–14 status text unchanged unless those were actually tested.
