# Phase F verification — Git, SSH and secrets (Tasks 19–23)

**Date:** 2026-11-15 · **D1 pass added:** 2026-11-21 · **Branch:** `v9-impl`
**Status:** merged; gates green; device pass complete (D1 + D2)
**Contract:** commit `c69ff45` · **Plan:** [`phase-f-plan.md`](phase-f-plan.md)

The `phase-f-core` and `phase-f-web` worktrees are merged on `v9-impl`. The Android and web gates are
green, and five defects that no JVM test could reach were found and fixed — one build failure and four
device-only faults. Device verification now covers both phones: T10–T14 all pass on D2 and on D1
(Android 9 / API 28), along with local Git operations, conflict resolution, pinned-host reuse,
changed-key rejection and the logcat key-material check. The D1 run closes the API 28 half of D-016:
JGit 5.13.3 works on the oldest supported device.

## Scope

| Task | Deliverable | Status |
|---|---|---|
| 19 | JGit version decision (D-016), dependency cleanup, HTTPS clone spike | done — D-016 recorded and settled; duplicate-class merge failure fixed in `993d4ad`; T10 HTTPS clone PASS on D1 and D2 |
| 20 | `SecretStore`: Keystore-wrapped AES-GCM blob store | done — JVM suites pass; T14 PASS on D1 and D2 |
| 21 | Local Git operations + Git tab | done — JVM and web suites pass; status/add/commit/diff/log/branch and a resolved conflict PASS on D1 and D2 |
| 22 | HTTPS/SSH remotes (`fetch/pull/push`), progress, errors, conflicts | done — T10 HTTPS clone, T12 SSH clone, T13 SSH push and T13 pull PASS on D1 and D2; the HTTPS-token push is covered by a CI test instead of a device row |
| 23 | SSH key manager, host-key prompt and `known_hosts` | done — T11 keygen PASS; prompt, pinned-host reuse, passphrase import and changed-key rejection PASS on D1 and D2 |

Out of scope for this pass: Git hooks, LFS, submodules, shallow clones, GitHub OAuth device flow,
root mode (Phase E) and Python (Phase G). Phase E stays deferred and both phones stay unrooted; nothing in
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
`testDebugUnitTest` 357 tests, `lintDebug` and `assembleDebug` green. HTTPS clone (T10), SSH clone
(T12), SSH push (T13) and SSH pull (T13P) pass on **both** D2 (Android 15) and D1 (Android 9 / API 28).
The set first failed to *assemble* on the merged tree; the `sshd-osgi` duplicate-class fix is in
[Device-only defects found and fixed](#device-only-defects-found-and-fixed). The D1 run is the API 28
compatibility measurement the decision was waiting for, so D-016's pinned version is now settled for
5.13.3. Decision record: `docs/decisions/README.md` D-016.

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

Run note: **357 Android unit tests pass on the merged tree (`testDebugUnitTest`)**. The run reports one
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
| Android `testDebugUnitTest` | PASS — 357 tests |
| Android `lintDebug` | PASS |
| Web `npm test` | PASS — 277 tests in 40 files |
| Web `npm run typecheck` / `lint` / `build` | PASS |
| `generateBridgeTypes` drift check | PASS — committed types under `web/src/bridge/types.gen.ts` are unchanged by the check |
| Android `assembleDebug` | PASS — produces `app-debug.apk` |

The gates were only reachable after `993d4ad` fixed a merged-tree build failure; see
[Device-only defects found and fixed](#device-only-defects-found-and-fixed) for that and the three
defects found on the device.

## Device verification (T10–T14)

Both phones ran a debug APK built from the merged tree (versionCode 2, targetSdk 28) against a scratch
workspace. D2 ran on 2026-11-15; **D1 ran on 2026-11-21**, which closes the API 28 gap. Run each row
on each device; never infer one device's result from the other. Steps are in
[`docs/test-matrix.md`](../test-matrix.md#phase-0d--git--ssh-tasks-1923).

The D2 raw runs are
[`20261115-211717-phaseF-D2-e76846f.txt`](../device-reports/20261115-211717-phaseF-D2-e76846f.txt)
and [`20261115-222841-phaseF-D2-e76846f-round2.txt`](../device-reports/20261115-222841-phaseF-D2-e76846f-round2.txt).
The D1 run is
[`20261121-131954-phaseF-D1-11f98015.txt`](../device-reports/20261121-131954-phaseF-D1-11f98015.txt):
one 16 MB logcat buffer covering T10, T11, T12, T12B, T13, T13P, T11B, T14 and T21 with nine PASS
lines and no FAIL, plus the changed-host-key rotation and `scripts/ssh-key-logcat.sh` exiting 0.
T11 mints a fresh key each run, so its public key must be added to the test server's
`authorized_keys` before T12/T13.

D1 reached the test server through `adb reverse tcp:2222` as `127.0.0.1:2222` because the host
(`192.168.34.247`) and D1 (`192.168.29.26`) were on different subnets; D1 has no VPN and its app UID
can use the reverse-loopback socket. D2 used the host's LAN address.

| Test | D1 (Android 9, API 28) | D2 (Android 15) | D2 evidence |
|---|---|---|---|
| T10 JGit HTTPS clone of a public repo | **PASS** — `https://github.com/octocat/Hello-World.git`, 4515 ms, 7 `git.progress` events, reply on finish; branch `master`, head `7fd1a60`, tree `.git,README` | **PASS** | 3181 ms with 7 `git.progress` events and the reply sent on finish; branch `master`, head `7fd1a60`, working tree `.git,README` |
| T11 Ed25519 keygen | **PASS** — id `91e826f9-3d78-4056-8b52-d1be73ad0e4b`, `type=ed25519`, fingerprint `SHA256:Z19SOjjoc7W8yMAIUSMTFY7ak6OtNrXclpKfCeRbysM`, public line `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJuxz/bdyPLIQBZj2cGxUDk22vDLKF3+Dxw7vRGNVgZc leocode-harness` matching `ssh-keygen -lf`; RSA fingerprint `SHA256:KDvWVDmjpyD04jJnqBjFSBxGyafvBL/8cpb/GJ0htMY`; private key an 82-byte ciphertext blob | **PASS** | id `115dc0c8-3eba-4326-b98d-6447d4be7dd4`, `type=ed25519`, fingerprint `SHA256:DfJYcVRxlSyI4b1liTdws+EKLTztCn1GFwac0kgOWNc`, public line `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF+/yexV1AMqZ0Ox2W17Z4VZG+PsDiWACpPNuGPPJ/Lr leocode-harness`, identical to `ssh-keygen -lf` on that public key; private key stored as an 82-byte ciphertext blob |
| T12 SSH clone | **PASS** — unknown host prompted once (`host=127.0.0.1`, `ssh-ed25519`, fingerprint `SHA256:EMcf7dnfZ/cYIa7iG4b6dkHIwt6esb4e8tE+DAFULH4` matching the server); `remember: true` wrote the valid line `[127.0.0.1]:2222 ssh-ed25519 …`; clone completed (`main`, head `004e795`, 7 files) | **PASS** | unknown host prompted once with `host=192.168.58.247`, `type=ssh-ed25519`, fingerprint `SHA256:fZbSQBKUY6xnK9glFydpKKFoAeFkEUJhC7R2G8iYd9o` — identical to `ssh-keygen -lf` on the server host key; `remember: true` wrote one valid line `[192.168.58.247]:2222 ssh-ed25519 …`; clone completed (`branch=main`, head `1e5c57d`, 5 files). A second clone with the pin in place prompted **zero** times and succeeded, so the stored key is found again |
| T13 push to a test repo | **PASS** — commit `c361695` pushed over SSH (`branch=main`, message "Pushed to origin") after 25 `git.progress` events ending at "Writing objects"; `git log` in the remote bare repository shows `c361695 harness: T13 push from device` | **PASS** | commit `775ed7d` pushed over SSH (`branch=master`, message "Pushed to origin") after 12 `git.progress` events ending at "Writing objects"; verified independently with `git log` in the remote bare repository, which shows `775ed7d harness: T13 push from device`. Emphasis on the HTTPS-token variant and on asserting the token is absent from replies/logs was not run |
| T14 Keystore envelope round-trip | **PASS** — round-trip matched; blob `LCS1` ciphertext, 58 bytes, `plaintextOnDisk=false`; a second T14 after force-stop + relaunch also passed; log `LeoCodeSecrets: strongBox=false` (no StrongBox) | **PASS** | token round-trip matched; blob is `LCS1` ciphertext, 57 bytes, `plaintextOnDisk=false`; survives force-stop + relaunch; log `LeoCodeSecrets: strongBox=false` (device reports no StrongBox) |
| No key material in logcat | **PASS** — `scripts/ssh-key-logcat.sh 11f98015` printed "clean: no private-key markers in logcat" and exited 0 after the T10–T14 runs | **PASS** | `scripts/ssh-key-logcat.sh 192.168.29.214:41293` printed "clean: no private-key markers in logcat" and exited 0 after the T10–T14 runs |

Additional rows measured on both devices: RSA keygen, passphrase-protected import, changed host key
rejected, conflict detected/resolved, and pull/push over SSH.

| Extra row | D1 result | D2 result |
|---|---|---|
| RSA keygen | **PASS** — `SHA256:KDvWVDmjpyD04jJnqBjFSBxGyafvBL/8cpb/GJ0htMY`, generated in the same run as T11 | **PASS** — `SHA256:RpJ6TZbbLRuwl4l8hrbs0hRHSEyUsx6Ge7sePeQk/7E`, generated in the same run as T11 |
| Local Git: init/status/add/commit/diff/log/branch | **PASS** — `init` created `main`; `a.txt` untracked then `added:a.txt`; commit `614da1f`; `diff` 8 lines (`binary=false`); `log` = `[main change, second, first]`; branches `[feature, main*]` | **PASS** — `init` created `main`; `a.txt` reported untracked then `added:a.txt` after `add`; commit `266ec63`; `diff` returned 8 lines (`binary=false`); `log` = `[main change, second, first]`; branches `[feature, main*]` |
| Conflict detected and resolved | **PASS** — one conflict on `a.txt`; markers plus `ours`/`theirs` parsed; `resolve` with `ours` cleared it; final content `one/two/main` | **PASS** — merging `feature` into `main` left one conflict on `a.txt`; `git.conflict` returned standard markers with both `ours` and `theirs` parsed; `git.resolve` with the `ours` strategy cleared the conflict list and the file ended as `one/two/main` |
| Pinned host reconnects without a prompt | **PASS** — second clone with the pin in place reported `promptEvents=0` and succeeded | **PASS** — second clone with the pin in place reported `promptEvents=0` and succeeded |
| Changed host key rejected | **PASS** — after rotating the server key from `SHA256:EMcf…` to `SHA256:BH2/…`, T12B failed in 1.7 s with `E_HOSTKEY_CHANGED` ("The host key changed; forget the host before trusting the new key") and **no** prompt; raw D12 reported `Server key did not validate`; restoring the original key made T12B pass again | **PASS** — after rotating the server host key the clone failed with `E_HOSTKEY_CHANGED` ("The host key changed; forget the host before trusting the new key") and emitted **no** prompt, which is the required fail-closed behaviour; restoring the original key restored the clone |
| Passphrase-protected key import | **PASS** — imported `b0b6895c-6491-4eec-9c3c-9670c5723c47` (`hasPassphrase=true`), unlocked with the correct passphrase, rejected a wrong passphrase and a missing one | **PASS** — imports a passphrase-protected PEM key (`hasPassphrase=true`), unlocks with the correct passphrase, and rejects both a wrong passphrase and no passphrase |
| Pull over SSH | **PASS** — two working copies cloned from one remote; the second pushed, the first pulled and fast-forwarded from `004e795` to `45e8827` with the new file present and identical | **PASS** — two working copies cloned from one remote; the second pushed a commit, the first pulled and fast-forwarded from `30b287f` to `c93cbd1` with the new file present and identical |

**T12/T13 status.** Both pass on both devices against a local SSH server (paramiko, committed as
`scripts/test-ssh-git-server.py`). D2 reached it over the host's LAN address because its VPN blocked
app-UID loopback; D1 reached it through `adb reverse` because it was on another subnet. Three defects
had to be fixed first — `user.home`, the prompt sink and the `known_hosts` host key — all of which are
recorded in [Device-only defects found and fixed](#device-only-defects-found-and-fixed).
The SSH clone, push and pull rows are the only ones measured against a controlled server rather
than a public host.

**Environment finding that gates T10.** While the phone's third-party VPN (`free.vpnindia…turbo`) was
active, **all** app-UID sockets failed — DNS (`UnknownHostException` for every name), loopback through
`adb reverse`, and LAN — while the `adb shell` UID was exempt. T10 only passes with that VPN off. This
is a property of the device environment, not a LeoCode defect, and any network row measured with the
VPN on is meaningless. D1 had no VPN, so its T10 and reverse-loopback rows were unaffected.

**D-016 note.** D1 was the compatibility gate, and it now passes T10–T14 with JGit
5.13.3.202401111512-r on API 28. The pinned version is settled; a future major bump still needs a
fresh D1 run. D2 exercises Android 15. Android 10–14 remain unverified by decision D-014.

## Device-only defects found and fixed

Four defects surfaced only on a device: no JVM test can reach these Android adapters, because the
unit suites substitute a fake cipher, a full Bouncy Castle, a JVM `user.home` and a same-thread event
sink. They were fixed in `69de290` (defects 1–2), `fb675a4` (defect 3), `2c4a2ac` (defect 4) and
`560a4aa` (defect 5).

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
  MINA initialises. `Crypto.ensureProviders()` takes that directory and sets the property; fixed in
  `fb675a4`.

### 4. The host-key prompt was never emitted (`2c4a2ac`)

- **Symptom.** An SSH clone to an unknown host blocked for the full 120 s wait and then failed, with
  `promptEvents=0` — the user was never asked to trust the key, and the operation could not succeed.
- **Root cause.** The prompt was emitted through a `ThreadLocal` stream sink bound in `withProgress()`
  on the calling thread. MINA invokes `ServerKeyDatabase.accept` on its own I/O thread, where that
  `ThreadLocal` is empty, so the emitter resolved to null and returned silently without emitting.
- **Fix.** `authFor()` takes the request's `StreamSink` directly and the emitter captures it, which is
  correct from any thread. The `ThreadLocal` was removed.

### 5. `known_hosts` rows were unusable on a non-default port (`560a4aa`)

- **Symptom.** Pinning a host on port 2222 wrote
  `[[192.168.58.247]:2222]:2222 ssh-ed25519 AAAA…` — not valid OpenSSH. The pin was never matched
  again, so the host was re-prompted on every connection and `ssh.hostkey.delete` could not forget it.
- **Root cause.** JGit passes the connect address to `lookup`/`accept` as `[host]:port`, and that value
  was used verbatim as the `known_hosts` and prompt key.
- **Fix.** `LeoSshSessionFactory.normalizeHost()` strips the brackets and trailing port at the factory
  boundary, keeping an IPv6 literal intact. Six unit tests cover the shapes JGit can pass.

**D-016 relevance.** Defects 1 and 5 are why D-016 could not be settled from JVM tests: the JVM suites
run with a full Bouncy Castle and hand the factory a bare host, so MINA digest resolution and the
`[host]:port` key shape only break on a device — and the failure mode depends on the API level, since
the Android 12 provider stub is why defect 1 surfaced at all. JGit/SSHD digest resolution is therefore
a device measurement, and D1 (API 28) now passes T10–T14, so D-016 is settled for the pinned version.

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

- **Device coverage is both supported phones.** T10–T14, the local Git rows, conflict resolution,
  pinned-host reuse, the changed-key rejection, passphrase-protected import, pull and the logcat
  key-material check pass on D1 (Android 9 / API 28) and D2 (Android 15). That closes the D-016
  compatibility gate. The HTTPS-token push is deliberately not a device row: it needs a
  token-authenticated remote, and its security claim is asserted in `PhaseFHandlerTest` instead. PASS
  values are single-run measurements on each device, not a soak.
- **D1 used a reverse-loopback SSH target.** The host and D1 were on different subnets, so the D1 run
  reached the test server through `adb reverse tcp:2222` as `127.0.0.1:2222`; the transport and
  host-key paths are the same, but the LAN path itself was exercised only on D2.
- **Network rows need the screen on, and the VPN off.** With the third-party VPN active no app-UID
  socket works; with the display asleep, app-UID sockets also fail while the `adb shell` UID is
  exempt. Both conditions produced false "cannot reach the remote" results before they were
  identified, so a failing network row should be re-run with the device unlocked and awake before it
  is recorded as a defect.
- **JGit 6.x is unproven on API 28.** D-016 is a deliberate fallback, not a claim that 6.x fails.
  Re-test on D1 before a major bump.
- **StrongBox is device-dependent.** T14 records yes/no per phone; a missing StrongBox is not a
  failure, only reduced key isolation.
- **No hooks, LFS, submodules or shallow clones.** They are non-goals of this pass and should fail
  with a plain message rather than corrupt a repository.
- **GitHub OAuth device flow is not implemented.** HTTPS remotes use a token or an existing
  credential; no browser login.
- **Phase E/root status is unchanged.** Both phones remain unrooted and Phase E remains deferred;
  Git/SSH work does not depend on root.
- **Android 10–14 remain unverified** (D-014); no hardware exists for them.
- **SSH host-key UI is WebView-driven.** If the WebView is detached, the prompt cannot be answered
  and the operation ends at the 120 s timeout; the bridge-disconnect rules still apply.

## Integrator checklist after the merge and device run

Done:

- Fill the JVM/web suite rows and the gate table with real counts — 357 Android unit tests, 277 web
  tests in 40 files, all gates PASS.
- Fix the merged-tree build failure and the device-only defects before filling device rows — `993d4ad`
  (build), `69de290` (two defects), `fb675a4` (`user.home`), `2c4a2ac` (prompt sink), `560a4aa`
  (`known_hosts` host key).
- Fill the D2 device rows: T10–T14, local Git operations, conflict resolution, pinned-host reuse,
  changed-key rejection, and the logcat key-material check, with evidence in both the device table and
  `docs/test-matrix.md`.
- Fill the D1 device rows (2026-11-21): T10–T14, RSA keygen, passphrase-protected import, local Git
  operations, conflict resolution, pinned-host reuse, changed-key rejection, pull, and the logcat
  key-material check. Evidence:
  [`20261121-131954-phaseF-D1-11f98015.txt`](../device-reports/20261121-131954-phaseF-D1-11f98015.txt).
  This closes D-016's API 28 half.

Still open:

- **Repeat runs / soak.** Every device result is one run per phone. A second consecutive full pass and
  the 4 h soak belong to Task 29 (Phase H), not this phase.
- **HTTPS-token push on a device.** Deliberately covered by `PhaseFHandlerTest` instead, because the
  claim is about replies rather than transport; a live token-authenticated remote remains unexercised.
- **Record the test server setup** if T12/T13 are to be repeated: the server is committed as
  [`scripts/test-ssh-git-server.py`](../../scripts/test-ssh-git-server.py) with setup steps in its
  header; the device's VPN must be off for any network row.
- Record any deviation from the contract in `docs/bridge-contract.md` first, then in this report.
- Keep the Phase E/root and Android 10–14 status text unchanged unless those were actually tested.
