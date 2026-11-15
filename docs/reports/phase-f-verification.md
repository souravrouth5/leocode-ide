# Phase F verification — Git, SSH and secrets (Tasks 19–23)

**Date:** 2026-11-15 · **Branch:** `phase-f-docs` · **Status:** draft — implementation in progress
**Contract:** commit `c69ff45` · **Plan:** [`phase-f-plan.md`](phase-f-plan.md)

This is a draft report. It records the locked contract, the D-016 decision and the test/device plan.
Every implementation result, gate and device cell below is marked **Pending**; the integrator fills
them after the `phase-f-core` / `phase-f-web` worktrees merge and the phones run T10–T14.

## Scope

| Task | Deliverable | Status |
|---|---|---|
| 19 | JGit version decision (D-016), dependency cleanup, HTTPS clone spike | code in progress (`phase-f-core`) |
| 20 | `SecretStore`: Keystore-wrapped AES-GCM blob store | code in progress (`phase-f-core`) |
| 21 | Local Git operations + Git tab | code in progress (`phase-f-core` + `phase-f-web`) |
| 22 | HTTPS/SSH remotes (`fetch/pull/push`), progress, errors, conflicts | code in progress |
| 23 | SSH key manager, host-key prompt and `known_hosts` | code in progress |

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

**Evidence.** Android build/device evidence: **Pending** (T10–T13 on D1). The dependency set itself is
the decision recorded above; it has not been exercised on a phone yet. Decision record:
`docs/decisions/README.md` D-016.

## Architecture

All of the following is the contract in `docs/reports/phase-f-plan.md`; code is being written in
`phase-f-core`. Nothing here is a test result.

### SecretStore (Task 20)

- `core/secrets/SecretCipher` is an interface (`encrypt`/`decrypt`/`delete`); JVM tests use a fake
  so no Android framework class is needed.
- `AndroidSecretCipher` owns one AES-256-GCM key in the Android Keystore
  (`leocode.secretstore.v1`), with StrongBox when the device reports it. The blob format is
  `LCS1 | version(1) | ivLen(1) | iv | ciphertext`.
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
- `LeoApp` calls `Crypto.ensureProviders()` before the first SSH operation. Bouncy Castle is used
  explicitly; Android's built-in `BC` provider is not replaced globally.

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

Contract rules that the implementation must keep:

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

Every result is **Pending** until the owning worktree merges. Do not copy a row to the merged tree
without running it there.

### JVM (`phase-f-core`)

| Suite | Covers | Result |
|---|---|---|
| `FileSecretStoreTest` | round-trip, ciphertext only on disk, delete, corrupt blob → null, unknown id → null | Pending |
| `SshKeyStoreTest` | Ed25519 + RSA generate, OpenSSH Ed25519 import, PEM RSA import, passphrase round-trip, wrong passphrase, stable fingerprint, delete, no private material in metadata | Pending |
| `KnownHostsStoreTest` | add/lookup/remove, `[host]:port`, duplicate suppression, changed-key detection, fingerprint format | Pending |
| `GitEngineTest` | init/status, add/commit/log/diff, branches, untracked→staged, reset, conflict markers + resolution, local clone, fetch/pull/push between temp repos, non-fast-forward, ahead/behind | Pending |
| `GitHandlerTest` | dispatch + error mapping with a fake engine/temp repos, bad `opId`, cancel, missing args, non-repo status, token never in replies | Pending |
| `HostKeyPromptsTest` | prompt emitted, answer accepted/rejected, 120 s timeout, changed-key shortcut | Pending |

### Web (`phase-f-web`)

| Suite | Covers | Result |
|---|---|---|
| `gitStore.test.ts` | init, status, stage/unstage, commit guards, log/branches, `hasToken` only, progress/cancel, host prompt, conflict blocks, workspace switch reset, error reporting | Pending |
| `mock.phaseF.test.ts` | mock init→add→commit→log→branch→checkout, HTTPS clone, SSH prompt before auth, token stored but never returned, key generate/import/delete | Pending |
| Existing suites | no regression | Pending |

### Gates on the merged tree

| Check | Result |
|---|---|
| Android `testDebugUnitTest` | Pending |
| Android `lintDebug` | Pending |
| Web `npm test` | Pending |
| Web `npm run typecheck` / `lint` / `build` | Pending |
| `generateBridgeTypes` drift check | Pending (contract already committed in `c69ff45`) |

## Device verification (T10–T14)

Both D1 and D2 are **Pending**. Use a debug APK from the merged tree and a scratch workspace. Run
each row on each device; never infer one device's result from the other. Steps are in
[`docs/test-matrix.md`](../test-matrix.md#phase-0d--git--ssh-tasks-1923).

| Test | D1 (Android 9, API 28) | D2 (Android 15) | Evidence to record |
|---|---|---|---|
| T10 JGit HTTPS clone of a public repo | **Pending** | **Pending** | serial, repo URL, clone duration, `git.progress` observed, reply on finish, logcat excerpt |
| T11 Ed25519 keygen | **Pending** | **Pending** | public line, fingerprint, `ssh-keygen -lf` comparison, logcat |
| T12 SSH clone | **Pending** | **Pending** | prompt fingerprint, remember result, `known_hosts` line, clone result |
| T13 push to a test repo | **Pending** | **Pending** | branch, remote verification, HTTPS-token variant, token absent from replies/logs |
| T14 Keystore envelope round-trip | **Pending** | **Pending** | token survives restart, ciphertext on disk, `LeoCodeSecrets: strongBox=yes/no`, invalidation → `E_UNSUPPORTED` |
| No key material in logcat | **Pending** | **Pending** | `scripts/ssh-key-logcat.sh` exit status and output |

Additional rows to fill after the main five: RSA keygen, passphrase-protected import, changed host
key rejected, conflict detected/resolved, and pull/push over both HTTPS and SSH.

**D-016 note.** D1 is the compatibility gate: a 5.13.3 failure on API 28 reopens D-016. D2 exercises
Android 15 but cannot prove the API 28 behaviour.

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

- **No merge and no device run.** All implementation, gate and device rows are Pending; this report
  must not be treated as evidence.
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

1. Fill the JVM/web suite rows and the gate table with real counts.
2. Run T10–T14 on D1 and D2; fill the device table and `docs/test-matrix.md`; cite raw logs and the
   `strongBox=` line.
3. Record any deviation from the contract in `docs/bridge-contract.md` first, then in this report.
4. If 5.13.3 fails on D1, reopen D-016 and record the failing API/stack before changing versions.
5. Keep the Phase E/root and Android 10–14 status text unchanged unless those were actually tested.
6. Run `scripts/ssh-key-logcat.sh <serial>` after the device pass and attach the exit status.
