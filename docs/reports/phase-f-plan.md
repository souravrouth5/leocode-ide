# Phase F — implementation plan and contract lock (Tasks 19–23)

Status: implemented and merged (2026-11-15). Phase E is deliberately deferred: D2 has no
`su`, and no rooted device is available. This document is the shared contract the implementation was
built against; results are in [`phase-f-verification.md`](phase-f-verification.md).

## Scope

| Task | Deliverable |
|---|---|
| 19 | JGit version decision (D-016), dependency cleanup, HTTPS clone spike |
| 20 | `SecretStore`: Keystore-wrapped AES-GCM blob store, no plaintext on disk |
| 21 | Local Git (`init/status/add/reset/commit/diff/log/branch/checkout`) + Git tab |
| 22 | HTTPS + SSH remotes (`fetch/pull/push`), progress, error mapping, conflicts |
| 23 | SSH key manager (generate/import/delete/copy) and host-key prompt / `known_hosts` |

Non-goals for this pass: Git hooks, LFS, submodules, shallow clones, GitHub OAuth device flow,
root mode (Phase E), and Python (Phase G).

## D-016 decision

**JGit 5.13.3.202401111512-r.** JGit 6.x is compiled for Java 11 and uses library APIs that are
not present on API 28 without core-library desugaring (e.g. `List.of`, `Map.of`,
`InputStream.readAllBytes`, `String.isBlank`). LeoCode minSdk is 28, has no desugaring
configured, and D1 (the only API 28 device) is offline this session, so the 6.x branch cannot be
proven safe on the oldest supported device. 5.13.x is the plan's documented fallback, targets
Java 8, and is supported by `org.eclipse.jgit.ssh.apache` with MINA SSHD. Re-test 6.x on D1
before every future major bump. Recorded in `docs/decisions/README.md` as D-016.

Dependencies after Task 19:

```
org.eclipse.jgit:org.eclipse.jgit:5.13.3.202401111512-r
org.eclipse.jgit:org.eclipse.jgit.ssh.apache:5.13.3.202401111512-r
org.apache.sshd:sshd-core:2.13.2
org.bouncycastle:bcprov-jdk18on:1.78.1
org.bouncycastle:bcpkix-jdk18on:1.78.1
```

If JGit 5.13 + SSHD 2.13.2 fails at runtime, pin SSHD to the version named by the JGit 5.13.3
POM rather than upgrading JGit.

## Security rules (D-009)

- Tokens and private keys are stored only as ciphertext in `filesDir/secrets/` and
  `filesDir/ssh/`; the Android Keystore key never leaves the device.
- No token, private key or passphrase is ever returned to the WebView, written to a log, or put
  into an error message. URLs are sanitised (userinfo removed) before any diagnostic.
- A secret is decrypted only for the operation that needs it and is not cached in a static field.
- The WebView may *send* a token/passphrase once (clone/remote setup or a protected-key unlock);
  the host stores it or uses it for that operation only.

## Bridge contract additions

All DTOs are in `bridge/Contract.kt` and are already in `web/src/bridge/types.gen.ts`. All `path`
arguments are relative to the active workspace and go through `PathJail`; `null` means the
workspace root. A repository that is not initialised is *not* an error: `git.status` returns
`initialized: false`.

| Method | Request → reply | Notes |
|---|---|---|
| `git.init` | `{ path?, branch? }` → `GitStatusReply` | Creates `.git`; default branch from config or `main` |
| `git.status` | `{ path? }` → `GitStatusReply` | Groups staged / changed / untracked / conflicts; ahead/behind from upstream |
| `git.add` | `{ path?, paths[] }` → `GitStatusReply` | Paths are repo-relative; `.`/`*` staged by UI as individual paths |
| `git.reset` | `{ path?, paths[] }` → `GitStatusReply` | Unstage (`git reset HEAD -- paths`); never discards work |
| `git.commit` | `{ path?, message, authorName?, authorEmail? }` → `GitCommitReply` | Empty index → `E_CONFLICT` with a plain message |
| `git.diff` | `{ path?, file?, staged? }` → `GitDiffReply` | Unified diff, 256 KB default cap; binary → `binary: true` and empty diff |
| `git.log` | `{ path?, max? }` → `GitLogReply` | Newest first, max 200 |
| `git.branch.list` | `{ path? }` → `GitBranchListReply` | Local + remote-tracking branches |
| `git.branch.create` | `{ path?, name, startPoint? }` → `GitStatusReply` | Does not check out |
| `git.branch.delete` | `{ path?, name }` → `GitStatusReply` | Refuses the current branch (`E_BUSY`) |
| `git.checkout` | `{ path?, name, create? }` → `GitStatusReply` | Dirty-tree conflicts → `E_CONFLICT` |
| `git.remote.list` | `{ path? }` → `GitRemoteListReply` | Never returns a token |
| `git.remote.set` | `{ path?, name, url, authKind?, username?, token?, keyId? }` → `GitRemoteListReply` | Token is stored in SecretStore; `""` deletes it |
| `git.remote.remove` | `{ path?, name }` → `GitRemoteListReply` | |
| `git.clone` | `{ url, path?, name?, auth?, opId? }` → `GitStatusReply` | Long request; `git.progress`; `opId` enables cancel |
| `git.fetch` | `{ path?, remote?, opId? }` → `GitSyncReply` | Long request; `git.progress` |
| `git.pull` | `{ path?, remote?, branch?, auth?, opId? }` → `GitSyncReply` | Merge conflicts → `E_CONFLICT` |
| `git.push` | `{ path?, remote?, branch?, auth?, opId?, force? }` → `GitSyncReply` | Rejected non-fast-forward → `E_CONFLICT` |
| `git.cancel` | `{ opId }` → `GitCancelReply` | Cancels a clone/fetch/pull/push; safe after completion |
| `git.conflict` | `{ path?, file }` → `GitConflictReply` | `merged` contains standard conflict markers; `ours`/`theirs` parsed; binary → `binary: true` |
| `git.resolve` | `{ path?, file, strategy: "ours"\|"theirs" }` → `GitStatusReply` | Whole-file resolution, then `git add` |
| `ssh.keys.list` | `{}` → `SshKeyListReply` | Public data only |
| `ssh.keys.generate` | `{ type, comment?, passphrase?, label?, bits? }` → `SshKeyInfo` | `ed25519` (default) or `rsa` (2048/3072/4096, default 3072) |
| `ssh.keys.import` | `{ content, passphrase?, label? }` → `SshKeyInfo` | OpenSSH, PEM, PKCS#8; content discarded after import |
| `ssh.keys.delete` | `{ id }` → `GitOk` | |
| `ssh.hostkey.answer` | `{ promptId, trust, remember }` → `GitOk` | Answers an `ssh.hostkey.prompt`; no client timeout |
| `ssh.hostkey.list` | `{}` → `SshKnownHostListReply` | SHA-256 fingerprints |
| `ssh.hostkey.delete` | `{ host, port }` → `GitOk` | Forget a host; required before trusting a changed key |
| `secrets.token.set` | `{ host, token }` → `GitOk` | Generic token slot, keyed by `host` |
| `secrets.token.delete` | `{ host }` → `GitOk` | |
| `secrets.token.list` | `{}` → `SecretHostsReply` | Keys only, never values |

Events (request-scoped, delivered on the long Git request):

```jsonc
{ "event": "git.progress", "payload": { "op": "clone", "opId": "…", "task": "Receiving objects", "done": 42, "total": 100 } }
{ "event": "ssh.hostkey.prompt", "payload": { "promptId": "…", "host": "github.com", "port": 22, "keyType": "ssh-ed25519", "fingerprintSha256": "SHA256:…", "changed": false } }
```

Host-key rules:

- Unknown host → emit the prompt and block that Git operation until `ssh.hostkey.answer` or a
  120 s timeout (`E_AUTH`, "host key was not confirmed"). `remember: true` writes `known_hosts`.
- Known host with a different key → **no prompt**: fail with `E_HOSTKEY_CHANGED` and say which
  host/port changed. The user must forget the host in SSH keys and reconnect.
- Rejecting an unknown host → `E_AUTH` ("host key rejected").

Error mapping for network ops:

| Cause | Code |
|---|---|
| Bad token / wrong key / passphrase / rejected host | `E_AUTH` |
| DNS, connect, TLS, socket timeout | `E_OFFLINE` |
| Merge conflict, non-fast-forward, dirty checkout | `E_CONFLICT` |
| Changed host key | `E_HOSTKEY_CHANGED` |
| Cancelled by `git.cancel` | `E_CANCELLED` |
| Two operations with one `opId` | `E_BUSY` |
| Anything else | `E_IO` (plain message, no exception text) |

Timeouts (update `web/src/bridge/timeouts.ts`):

- `git.clone/fetch/pull/push`: no default timeout (progress + `git.cancel`).
- `git.cancel`: 2 s.
- All other `git.*`/`ssh.*`: 20 s (writes) or 10 s (reads).
- `git.status`/`diff`/`log`/`branch.list`/`remote.list` are idempotent reads.

## Android architecture (worktree `phase-f-core`)

New packages:

```
core/secrets/  SecretCipher, AndroidSecretCipher, FileSecretStore, SecretUnavailableException
ssh/           SshKeyStore, KnownHostsStore, HostKeyPrompts, LeoSshSessionFactory, Crypto
git/           GitEngine, GitProgressMonitor, GitErrors, GitAuthResolver
bridge/        GitHandler.kt, SshHandler.kt, SecretHandler.kt
```

- `SecretCipher` is an interface so JVM tests use a fake. `AndroidSecretCipher` uses one
  AES-256-GCM Keystore key (`leocode.secretstore.v1`), StrongBox when available, and the blob
  format `LCS1 | version(1) | ivLen(1) | iv | ciphertext`. Key invalidation maps to
  `E_UNSUPPORTED` with "Stored tokens and keys are unavailable on this device; re-enter them".
- `FileSecretStore` writes one file per secret id under `filesDir/secrets/`, atomically, with a
  hex/opaque filename derived from the id. `ids()` lists them; `delete` removes the file.
- `SshKeyStore` metadata in `filesDir/ssh/keys.json`; private material in `FileSecretStore` under
  `ssh-key:<id>` (PKCS#8, encrypted with the passphrase with BC when one is set). Passphrases are
  never stored. Public key lines via MINA `PublicKeyEntry.toString`, fingerprints via
  `KeyUtils.getFingerPrint`. `type` is `ed25519`, `rsa` or `ecdsa`.
- `KnownHostsStore` is OpenSSH-compatible (`host keytype base64`, `[host]:port` for non-22),
  atomic writes, no duplicate lines. Display fingerprints are SHA-256.
- `HostKeyPrompts` holds pending prompts (`CompletableFuture<Answer>`), emits
  `ssh.hostkey.prompt` through the Git request's `StreamSink`, and times out after 120 s.
- `LeoSshSessionFactory` extends JGit's `SshdSessionFactory`: `getDefaultKeys` returns the stored
  keypairs (selected key only when `auth.keyId` is set), `getDefaultIdentities` is empty, and
  `getServerKeyDatabase` returns the prompt-aware database. Install it per transport via
  `TransportConfigCallback`; never mutate the global `SshSessionFactory`.
- `GitEngine` uses a fresh `Git.open`/`Git.init` per call, `PathJail` for every path, and closes
  repositories. Network ops use a `ProgressMonitor` that emits `git.progress` throttled by the
  existing sink (`.progress` names are already throttled at 100 ms).
- `GitHandler` is an `AsyncBridgeHandler` with a small named thread pool. `git.cancel` is handled
  immediately on the calling thread. Keep an `opId → Cancellation` map; remove it in `finally`.
  `git.status` etc. may still run on the pool; they respond through `respond`.
- `AppGraph` owns `secretStore`, `sshKeyStore`, `knownHosts`, `hostKeyPrompts`, `gitHandler`,
  `sshHandler`, `secretHandler`. Add the three handlers to the router list in `MainActivity`.
- `LeoApp` must call `Crypto.ensureProviders()` before the first SSH operation (BC provider used
  explicitly; do not replace Android's built-in `BC` provider globally).
- Log one line at Keystore creation: `LeoCodeSecrets: strongBox=<boolean>` for T14 evidence.

JVM tests (must fail before the fix, pass after; no Android framework classes):

- `FileSecretStoreTest`: round-trip, ciphertext-only on disk, delete, corrupt blob → null,
  unknown id → null.
- `SshKeyStoreTest`: Ed25519 + RSA generate; OpenSSH Ed25519 import; PEM RSA import; passphrase
  round-trip; wrong passphrase fails; fingerprint stable; delete; no private material in metadata.
- `KnownHostsStoreTest`: add/lookup/remove, `[host]:port`, duplicate suppression, changed key
  detection, fingerprint format.
- `GitEngineTest` (temp repos): init/status, add/commit/log/diff, branch create/checkout/delete,
  untracked→staged transitions, reset, conflict markers + ours/theirs resolution, clone from a
  local bare repo, fetch/pull/push between two local repos, non-fast-forward rejection,
  ahead/behind.
- `GitHandlerTest`: method dispatch + error mapping with a fake engine or temp repos (no
  network): bad op id, cancel, missing args, status of a non-repo, token never in replies.
- `HostKeyPromptsTest`: prompt emitted, answer accepted/rejected, timeout, changed key shortcut.

## Web architecture (worktree `phase-f-web`)

- `Bridge` gains the methods above; `AndroidBridge` maps `git.progress` / `ssh.hostkey.prompt`
  from the request stream; `MockBridge` implements an in-memory demo repo, SSH keys, host prompt
  and remote tokens.
- `features/git/gitStore.ts` owns: status, view tab (`changes|history|branches`), log, branches,
  remotes, SSH keys, diff, conflict, progress, host prompt, busy flags. It reports errors via
  `errors`. It resets and refreshes on `leocode:workspace-switched` and when the Git view opens.
- `features/git/GitView.tsx` plus `GitChanges`, `GitHistory`, `GitBranches`, `GitDiffSheet`,
  `GitConflictSheet`, `GitRemoteSheet`, `SshKeysSheet`, `HostKeySheet`, `GitProgressBanner`.
- `shellStore.View` adds `"git"`; `BottomNav` adds a Git tab using the existing `GitIcon`;
  `Shell` renders `GitView`; `AppDialogs` mounts the Git sheets inside `PaneBoundary`.
- Settings: add `gitName`/`gitEmail` to `UserSettings` (defaults `""` / `""`), a small Git & SSH
  card (author fields, buttons to open SSH keys / remotes via the Git tab). Keep the card compact.
- UI rules: mobile-first, tap targets ≥ 40 px, all destructive actions through `dialogs.confirm`,
  empty states with one primary action, no JS `alert/confirm/prompt`, accessible labels for
  device automation. Commit box: disabled unless staged files exist and the message is non-blank.
  Conflict sheet: per-block "Use mine" / "Use theirs" / "Use both"; saving writes the file with
  `fs.write` then calls `git.add`; whole-file buttons call `git.resolve`.
- `styles/git.css` imported from `styles/index.css`; use tokens only.

Web tests:

- `gitStore.test.ts`: init, status load, stage/unstage, commit guards, log/branches, remote token
  (only `hasToken`), progress/cancel, host prompt answer, conflict block resolution, workspace
  switch reset, error reporting.
- `mock.phaseF.test.ts`: mock init→add→commit→log→branch→checkout; clone over HTTPS; SSH prompt
  before auth; token stored but never returned; SSH key generate/import/delete.
- Keep all existing tests green.

## Docs (worktree `phase-f-docs`)

- `docs/bridge-contract.md`: status `live (Task 19–23)`, method/event detail, timeout table,
  security notes, host-key rules.
- `docs/decisions/README.md`: D-016 record (chosen version, evidence, fallback, re-test trigger).
- `docs/test-matrix.md`: T10–T14 rows and results placeholders.
- `PROGRESS.md`: Phase F rows, timeline entry.
- `docs/reports/phase-f-verification.md`: what was built, tests, device evidence, caveats.
- `scripts/` helper for the Task 23 logcat key-material grep, if small and useful.

## Parallel work rules

- Branches/worktrees: `phase-f-core`, `phase-f-web`, `phase-f-docs`, all based on the commit that
  adds this document. Merge back into `v9-impl` with `--no-ff`; never push.
- Do not touch files owned by another worktree (see above). Contract DTOs and generated types are
  already committed on the base; if a change is unavoidable, report it instead of editing.
- One commit per task or coherent batch, conventional message (`feat(android): …`,
  `feat(web): …`, `docs(phase-f): …`). Run the relevant tests before committing.
- Only `phase-f-core` may modify Gradle files. Do not run a full Gradle build while another
  Gradle task is running: this laptop has 3.7 GB RAM. Web agents may run `npm test`/`typecheck`.
- If a device or network check cannot be done, say so in the commit/report; never fabricate a
  result.
