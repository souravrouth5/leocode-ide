# LeoCode Bridge Contract — v1 (draft, updated for plan v9)

Transport: `WebViewCompat.addWebMessageListener` on the single allowed origin produced by
`WebViewAssetLoader` (`https://appassets.androidplatform.net`). Debug builds may also allow the
Vite dev origin. `addJavascriptInterface` is forbidden. Kotlin models are `@Serializable`;
TypeScript types are generated into `web/src/bridge/types.gen.ts`, never hand-written (Task 7).

Status markers in the method table: **live** = implemented and unit-tested on the host (device
verification is tracked in `docs/test-matrix.md`), **planned** = added by the v9 task named.

**Phase F (Tasks 19–23).** The `git.*`, `ssh.keys.*`, `ssh.hostkey.*` and `secrets.token.*` DTOs
and generated types are committed (`c69ff45`), so those methods are marked **live (Task 19–23)** and
are part of v1. The handlers are merged on `v9-impl`. D2 device evidence covers T10–T14, local Git
operations, conflict resolution, pinned-host reuse, changed-key rejection and the logcat
key-material check; D1 (API 28) has not run, and `pull`, the HTTPS-token push and
passphrase-protected import are unrun. Details in `docs/reports/phase-f-verification.md`.

## Envelope

```jsonc
// request  (TS → Kotlin)
{ "v": 1, "id": "42", "method": "fs.read", "payload": { "path": "src/main.py" } }

// reply    (Kotlin → TS) exactly one per request
{ "v": 1, "id": "42", "ok": true,  "payload": { "content": "..." } }
{ "v": 1, "id": "42", "ok": false, "error": { "code": "E_PATH_OUTSIDE_ROOT", "message": "…" } }
{ "v": 1, "id": "43", "ok": false, "error": { "code": "E_INTERNAL", "message": "Something went wrong", "correlationId": "c-7f3a2e" } }

// event    (Kotlin → TS) zero or more per request
{ "v": 1, "id": "42", "event": "proc.stdout", "payload": { "data": "..." } }
```

## Rules

- `id` is unique per request and echoed in replies and events.
- **Version check:** the host rejects any `v` it does not serve with `E_UNSUPPORTED`; the client
  ignores replies with an unknown `v`.
- **Exactly one reply** per request, including for requests that wait on the user (SAF pickers,
  permission dialogs, host-key prompts). These are keyed by request `id`; there are no single-slot
  callbacks, so concurrent requests never overwrite each other.
- **Size limits:** max incoming message 8 MB (`E_LIMIT`), which covers a 4 MB write plus JSON
  escaping. `fs.read` and `fs.write` share one 4 MB cap, so the app can always open what it wrote;
  `fs.read` also accepts `offset` / `maxBytes` and returns `nextOffset` for chunked reads (Task 15),
  so a file above the cap can still be paged through. Memory cost of one 4 MB read: 4 MB of bytes,
  the decoded string and the encoded reply, so budget roughly 12–16 MB of heap for that request.
  SAF reads and writes are capped at 4 MB.
- **Streaming:** process and terminal output is coalesced at 16 ms per stream. Terminal output is
  gated by `term.ack` credit (default window 256 KB); the host pauses reading the PTY when credit
  is exhausted.
- **Path jail:** every path argument is canonicalised (symlinks resolved) and must remain under an
  allowed root: a workspace root, or the shared-storage root while the storage permission is
  granted. Prefix comparison is `root + "/"`. Anything else → `E_PATH_OUTSIDE_ROOT`. No method
  accepts root (`su`) file paths.
- **Errors are safe:** messages are plain language and contain no stack traces, exception class
  names, secrets, or paths outside allowed roots. `E_INTERNAL` carries a `correlationId` that
  matches a redacted host log line.
- Unknown `method` → `E_UNKNOWN_METHOD`. Malformed envelope → `E_BAD_ENVELOPE`; the connection
  is kept.
- No secrets (tokens, private keys, passphrases after submission) ever cross the bridge toward
  the WebView. The WebView may *send* a token or passphrase once (remote setup, clone/pull/push,
  or a protected-key unlock); it is never echoed in a reply, event, error or log. `git.remote.list`
  reports `hasToken` only, and `ssh.keys.list` returns public data only.
- `git.clone/fetch/pull/push` reply when the operation **finishes**, not when it starts; they are
  cancellable through `git.cancel` with a client-generated `opId` and have no default client
  timeout (see Timeouts).

## Timeouts (client defaults)

The client (Task 11) rejects with `E_TIMEOUT` if no reply arrives in time and drops late replies.
Any request can be cancelled with an `AbortSignal` → `E_CANCELLED`.

| Class | Methods | Default |
|---|---|---|
| Fast | `app.*`, `fs.list/read/stat/mkdir/rename/delete`, `term.write/resize/ack`, `proc.stdin`, `root.status`, `root.disable`, `draft.list/read`, `workspace.list`, `git.status/diff/log/branch.list/remote.list`, `ssh.keys.list`, `ssh.hostkey.list`, `secrets.token.list` | 10 s |
| Write | `fs.write`, `workspace.*`, `draft.save/delete`, `git.init/add/reset/commit/branch.create/branch.delete/checkout/remote.set/remote.remove/conflict/resolve`, `ssh.keys.generate/import/delete`, `ssh.hostkey.delete`, `secrets.token.set/delete` | 20 s |
| User-wait | `saf.*`, `storage.requestPermission`, `root.request`, `ssh.hostkey.answer` | none (user-driven; cancellable) |
| Long, streamed | `proc.run` | reply on start within 10 s; then events, no overall timeout |
| Long Git | `git.clone/fetch/pull/push` | **none**: the reply is the finished operation; `git.progress` in the meantime; cancel with `git.cancel` |
| Search | `fs.search` | 60 s (the reply is the summary after the stream) |
| Control | `fs.search.cancel`, `git.cancel` | 2 s |
| Install | `runtime.install`, `runtime.repair` | reply on start within 10 s (`{ id, started }`); then `runtime.progress` events and one terminal `runtime.result`; no overall client timeout; cancel with `runtime.cancel` |
| Update | `update.install` | reply on start within 10 s (`{ started }`); then `update.progress` events and one terminal `update.result`; no overall client timeout; cancel with `update.cancel` |

Git notes:

- `git.clone/fetch/pull/push` must not be moved back to "reply on start": the request spans the
  whole network operation and the reply is `GitStatusReply` / `GitSyncReply` after completion.
  The client sets no default timeout for them and shows progress until the reply, an error or a
  `git.cancel`.
- `git.cancel` is a small control message (2 s). It is safe after completion (`cancelled: false`)
  and in-flight cancellation rejects the long request with `E_CANCELLED`.
- `git.status`, `git.diff`, `git.log`, `git.branch.list` and `git.remote.list` are idempotent reads
  (10 s, one retry after a timeout). All other `git.*` and `ssh.*` calls are writes (20 s).
- `ssh.hostkey.answer` answers a prompt the host is already waiting on; it has no client timeout,
  while the *blocked Git operation* gives the user 120 s (see Host keys).

If the host stops answering entirely (WebView detached, renderer restarted), every pending
request rejects with `E_BRIDGE_DISCONNECTED` (web side only). The client raises this after three
consecutive request timeouts, when the injected channel object changes, or when the page
dispatches `leocode:bridge-disconnected`; open streams receive their failure callback and later
calls fail immediately.

## Error codes

Kotlin `ErrorCode` enum is the single source; the TS `ErrorCode` union is generated. Every code
has a UI catalog entry (`web/src/errors/catalog.ts`, Task 12).

| Code | Meaning | Typical surface |
|---|---|---|
| `E_BAD_ENVELOPE` | Malformed JSON or missing fields | Sheet (bug) |
| `E_UNKNOWN_METHOD` | Method not in the allowlist | Sheet (bug) |
| `E_UNSUPPORTED` | Protocol version or feature not supported on this device/build | Banner |
| `E_TIMEOUT` | No reply within the method's timeout | Banner + Retry |
| `E_CANCELLED` | User or caller cancelled | Snackbar or none |
| `E_BRIDGE_DISCONNECTED` | Host stopped answering (web side only) | Banner + Reload |
| `E_PATH_OUTSIDE_ROOT` | Path escaped every allowed root after canonicalisation | Sheet |
| `E_NOT_FOUND` | File / workspace / runtime / key missing | Snackbar or sheet |
| `E_NOT_DIR` | Directory expected | Snackbar |
| `E_EXISTS` | Target already exists | Inline field error |
| `E_BINARY` | File is not UTF-8 text | Banner in editor |
| `E_IO` | Filesystem failure | Sheet + Retry |
| `E_DISK_FULL` | Not enough free space | Sheet + Free space |
| `E_CONFLICT` | File changed on disk, or Git merge conflict | Banner |
| `E_PERMISSION` | Android permission or SAF denial | Sheet + Open settings |
| `E_LIMIT` | Size / process / output limit hit | Snackbar or banner |
| `E_BUSY` | Operation already running for this resource | Snackbar |
| `E_NO_RUNTIME` | Requested runtime not installed | Banner + Install |
| `E_OFFLINE` | No network / DNS failure / connection refused | Banner + Retry |
| `E_AUTH` | Git/SSH authentication failed | Sheet + Update credentials |
| `E_HOSTKEY_CHANGED` | Host key mismatch — requires explicit user action | Sheet (blocking) |
| `E_ROOT_UNAVAILABLE` | No `su` on this device | Inline in settings |
| `E_ROOT_DENIED` | Root grant refused or revoked | Sheet + Try again |
| `E_INTERNAL` | Unexpected; logged with a correlation id, no secrets | Sheet + Copy details |

## Methods (v1)

| Method | Payload → Reply | Status | Notes |
|---|---|---|---|
| `app.ping` | `{}` → `{}` | live | Attach check |
| `app.info` | `{}` → `{ app, version, mode, androidSdk, androidRelease, abi, webview, workspace, theme }` | live | Used by the shell, degraded-mode detection and diagnostics |
| `app.theme.get` / `app.theme.set` | `{ mode? }` → `{ mode, effective }` | live | Syncs system bars |
| `app.diagnostics` | `{}` → `{ report }` | live (Task 27) | Redacted plain-text support report; Copy/Share in Diagnostics |
| `app.share` | `{ text }` → `{ shared }` | live (Task 27) | Opens the system share chooser; redacts `text` again before sending |
| `storage.info` | `{}` → `{ hasPermission, internalStorage, downloads, documents, workspace }` | live | Shape kept from v0; Task 27 may extend |
| `storage.requestPermission` | `{}` → `{ granted }` | live | User-wait |
| `saf.open` | `{ mime? }` → `{ name, uri, content, size }` (or `null` on cancel) | live | Copy-in; 4 MB cap |
| `saf.save` | `{ name, content }` → `{ name, uri }` (or `null` on cancel) | live | Copy-out; 4 MB cap |
| `saf.importTree` | `{ dest? }` → `{ path, files, bytes }` (or `null` on cancel) + `saf.progress` | live (Task 14) | Folder copy-in; never overwrites an existing name |
| `saf.exportWorkspace` | `{}` → `{ name, uri, files, bytes }` (or `null`) + `saf.progress` | live (Task 14) | Zip copy-out of the active workspace |
| `saf.restoreArchive` | `{ confirm: true }` → `{ files, bytes }` (or `null`) + `saf.progress` | live (Task 14) | Strict zip restore: safe entry names, size/file caps, atomic per-file replace |
| `workspace.list` | `{}` → `{ active, workspaces: [{ id, name, path, lastOpened, createdAt }] }` | live (Task 14) | Default workspace first, then most recently opened |
| `workspace.create` | `{ name }` → `{ id, name, path }` | live (Task 14) | Unique id under `workspace/workspaces/` |
| `workspace.open` | `{ id }` → `{ id, name, path }` | live (Task 14) | Makes it the active root and updates `lastOpened` |
| `workspace.rename` | `{ id, name }` → `{}` | live (Task 14) | Display name only; the directory does not move |
| `workspace.delete` | `{ id }` → `{}` | live (Task 14) | Confirmation in UI; moves to trash; `default` is refused |
| `fs.list` | `{ path }` → `[{ name, path, kind, size, mtime }]` | live | No recursion |
| `fs.stat` | `{ path }` → `{ path, kind, size, mtime, hash }` | live (Task 15) | SHA-256 baseline used for conflict detection |
| `fs.read` | `{ path, offset?, maxBytes? }` → `{ path, content, size, nextOffset, mtime, hash }` | live (chunking + hash, Task 15) | UTF-8 only, 4 MB cap per call; `nextOffset: -1` means the file ended; binaries and malformed UTF-8 → `E_BINARY`; anything that is not a regular file (FIFO, socket, device) → `E_NOT_DIR` |
| `fs.write` | `{ path, content, expectedHash? }` → `{ path, size, mtime, hash }` | live (atomic since Task 4; `expectedHash` Task 15) | temp → fsync → rename; a stale `expectedHash` → `E_CONFLICT`; `null` means create/overwrite |
| `fs.mkdir` | `{ path }` → `{}` | live | |
| `fs.rename` | `{ from, to }` → `{}` | live | Acts on the directory entry: renaming a symlink renames the link, not its target; a case-only rename is allowed when both names resolve to one file |
| `fs.delete` | `{ path }` → `{}` | live | Moves to trash, never silent permanent delete; removing a symlink removes the link, not its target |
| `fs.search` | `{ query, glob?, caseSensitive?, maxResults?, searchId? }` → `search.match` events, then `{ count, truncated }` | live (Task 16) | Ignores `.git`, `node_modules`, `.venv`, `__pycache__`; cancellable with `searchId`; results capped (default 500, max 2 000) |
| `fs.search.cancel` | `{ searchId }` → `{ cancelled }` | live (Task 16) | Safe to call after the search finished (`false`) |
| `draft.list` | `{}` → `[{ path, mtime, size }]` | live (Task 15) | Drafts of the active workspace only |
| `draft.read` | `{ path }` → `{ path, content, eol, mtime }` or `null` | live (Task 15) | Outside the workspace tree, keyed by path hash |
| `draft.save` | `{ path, content, eol }` → `{}` | live (Task 15) | 4 MB cap; replaces the previous draft atomically |
| `draft.delete` | `{ path }` → `{}` | live (Task 15) | Also called after a successful save or discard |
| `term.open` | `{ cwd, cols, rows, root? }` → `{ sessionId, pid }` | live (`root` Task 18) | Spawns the PTY (or `su` in PTY) and attaches this request's stream; the reply is sent before the first `term.data` |
| `term.attach` | `{ sessionId }` → `{ sessionId, scrollback, alive, exitCode }` then `term.data` events | live (Task 10) | Replays the ring-buffer scrollback, then streams live output; a session that exited while detached is removed, so attach returns `E_NOT_FOUND` and the page opens a new terminal |
| `term.list` | `{}` → `[{ sessionId, root, alive, title, pid, cwd }]` | live (Task 10) | Sessions survive Activity/WebView recreation via `SessionService` |
| `term.write` | `{ sessionId, b64 }` → `{ accepted }` | live | base64 bytes |
| `term.resize` | `{ sessionId, cols, rows }` → `{ ok }` | live | SIGWINCH |
| `term.ack` | `{ sessionId, bytes }` → `{ ok }` | live (Task 6) | Backpressure credit; 256 KB window |
| `term.close` | `{ sessionId }` → `{ closed }` | live | Kills the process group (via `su` for root sessions) |
| `proc.run` | `{ cwd, argv[], env?, timeoutMs?, root?, stdin? }` → `{ jobId, pid }` | live (`root` Task 18, `stdin` 2026-11-25) | Events `proc.stdout/stderr/exit`; env keys allowlisted; no timeout by default. `stdin: false` (default) closes the child's stdin at once so `cat`/`input()` cannot block forever; `stdin: true` keeps the pipe open for `proc.stdin` |
| `proc.stdin` | `{ jobId, data }` → `{ written }` | live (2026-11-25) | UTF-8 text to a job started with `stdin: true`; `written: false` when the job is gone or the pipe is closed. The reply waits for the child to read (pipe backpressure), so the client timeout still applies |
| `proc.cancel` | `{ jobId }` → `{}` | live (grace period Task 6) | SIGTERM → 2 s → SIGKILL on the group |
| `root.status` | `{}` → `{ available, granted, enabled }` | live (Task 17) | Never prompts |
| `root.request` | `{}` → `{ granted }` | live (Task 17) | User-wait; `E_ROOT_UNAVAILABLE` / `E_ROOT_DENIED` |
| `root.disable` | `{}` → `{ available, granted, enabled }` | live (Task 17) | Clears the preference, ends root sessions and jobs, never prompts |
| `git.init` | `{ path?, branch? }` → `GitStatusReply` | live (Task 19–23) | Creates `.git`; default branch from config or `main` |
| `git.status` | `{ path? }` → `GitStatusReply` | live (Task 19–23) | Groups staged / changed / untracked / conflicts; ahead/behind from upstream |
| `git.add` | `{ path?, paths[] }` → `GitStatusReply` | live (Task 19–23) | Paths are repo-relative; `.`/`*` staged by the UI as individual paths |
| `git.reset` | `{ path?, paths[] }` → `GitStatusReply` | live (Task 19–23) | Unstage (`git reset HEAD -- paths`); never discards work |
| `git.commit` | `{ path?, message, authorName?, authorEmail? }` → `GitCommitReply` | live (Task 19–23) | Empty index → `E_CONFLICT` with a plain message |
| `git.diff` | `{ path?, file?, staged?, maxBytes? }` → `GitDiffReply` | live (Task 19–23) | Unified diff, 256 KB default cap; binary → `binary: true` and empty diff |
| `git.log` | `{ path?, max? }` → `GitLogReply` | live (Task 19–23) | Newest first, max 200 |
| `git.branch.list` | `{ path? }` → `GitBranchListReply` | live (Task 19–23) | Local + remote-tracking branches |
| `git.branch.create` | `{ path?, name, startPoint? }` → `GitStatusReply` | live (Task 19–23) | Does not check out |
| `git.branch.delete` | `{ path?, name }` → `GitStatusReply` | live (Task 19–23) | Refuses the current branch (`E_BUSY`) |
| `git.checkout` | `{ path?, name, create? }` → `GitStatusReply` | live (Task 19–23) | Dirty-tree conflicts → `E_CONFLICT` |
| `git.remote.list` | `{ path? }` → `GitRemoteListReply` | live (Task 19–23) | Never returns a token |
| `git.remote.set` | `{ path?, name, url, authKind?, username?, token?, keyId? }` → `GitRemoteListReply` | live (Task 19–23) | Token is stored in SecretStore; `""` deletes it |
| `git.remote.remove` | `{ path?, name }` → `GitRemoteListReply` | live (Task 19–23) | |
| `git.clone` | `{ url, path?, name?, auth?, opId? }` → `GitStatusReply` | live (Task 19–23) | Long request; reply on finish; `git.progress`; `opId` enables cancel |
| `git.fetch` | `{ path?, remote?, auth?, opId? }` → `GitSyncReply` | live (Task 19–23) | Long request; reply on finish; `git.progress` |
| `git.pull` | `{ path?, remote?, branch?, auth?, opId? }` → `GitSyncReply` | live (Task 19–23) | Long request; merge conflicts → `E_CONFLICT` |
| `git.push` | `{ path?, remote?, branch?, auth?, opId?, force? }` → `GitSyncReply` | live (Task 19–23) | Long request; rejected non-fast-forward → `E_CONFLICT` |
| `git.cancel` | `{ opId }` → `GitCancelReply` | live (Task 19–23) | Cancels a clone/fetch/pull/push; safe after completion |
| `git.conflict` | `{ path?, file }` → `GitConflictReply` | live (Task 19–23) | `merged` contains standard conflict markers; `ours`/`theirs` parsed; binary → `binary: true` |
| `git.resolve` | `{ path?, file, strategy: "ours"\|"theirs" }` → `GitStatusReply` | live (Task 19–23) | Whole-file resolution, then `git add` |
| `ssh.keys.list` | `{}` → `SshKeyListReply` | live (Task 19–23) | Public data only |
| `ssh.keys.generate` | `{ type?, comment?, passphrase?, label?, bits? }` → `SshKeyInfo` | live (Task 19–23) | `ed25519` (default) or `rsa` (2048/3072/4096, default 3072) |
| `ssh.keys.import` | `{ content, passphrase?, label? }` → `SshKeyInfo` | live (Task 19–23) | OpenSSH, PEM, PKCS#8; content discarded after import |
| `ssh.keys.delete` | `{ id }` → `GitOk` | live (Task 19–23) | |
| `ssh.hostkey.answer` | `{ promptId, trust, remember? }` → `GitOk` | live (Task 19–23) | Answers an `ssh.hostkey.prompt`; no client timeout |
| `ssh.hostkey.list` | `{}` → `SshKnownHostListReply` | live (Task 19–23) | SHA-256 fingerprints |
| `ssh.hostkey.delete` | `{ host, port? }` → `GitOk` | live (Task 19–23) | Forget a host; required before trusting a changed key |
| `secrets.token.set` | `{ host, token }` → `GitOk` | live (Task 19–23) | Generic token slot, keyed by `host` |
| `secrets.token.delete` | `{ host }` → `GitOk` | live (Task 19–23) | |
| `secrets.token.list` | `{}` → `SecretHostsReply` | live (Task 19–23) | Keys only, never values |
| `runtime.catalog` | `{}` → `[{ id, version, versionCode, installed, healthy, installedVersionCode }]` | live (Task 25) | Manifest-verified; `healthy` checks the promised executables |
| `runtime.install` | `{ id }` → `{ id, started }` at start, then `runtime.progress` events and one `runtime.result` | live (Task 25) | `E_BUSY` while an id is installing |
| `runtime.cancel` | `{ id }` → `{ cancelling }` | live | Flags the running job; polled during download, extract, configure and health |
| `runtime.repair` | `{ id }` → `{ id, started }`, then events as `runtime.install` | live (Task 25) | Keeps the current tree until the new one passes its health check |
| `runtime.uninstall` | `{ id }` → `{}` | live (Task 25) | Removes the tree only when its marker names `id`; clears the rollback counter |
| `update.check` | `{}` → `{ available, currentVersion, versionName?, versionCode?, notes?, url?, sha256?, size? }` | live (Task 28) | Fetches and verifies the signed `release.json`; `available` compares version codes |
| `update.install` | `{ url, sha256, size, versionCode }` → `{ started }`, then `update.progress` events and one `update.result` | live (Task 28) | Downloads, checks SHA-256/size/package/version/signer set, then opens the system installer |
| `update.cancel` | `{}` → `{ cancelling }` | live (Task 28) | Flags the running download; safe when idle |
| `language.list` | `{}` → `[{ id, name, extensions[], runtimeId, hasRepl, template }]` | planned (Task 30) | Language providers (D-017); Python is the first |
| `trust.check` | `{ project?, action, path? }` → `{ trusted, action, fingerprint }` | live (Task 26) | Scripts, pip, venv, Git hooks; host computes the fingerprint |
| `trust.grant` | `{ project?, action, path? }` → `{ trusted: true, action, fingerprint }` | live (Task 26) | Remembers the decision for the current files |
| `trust.revoke` | `{ project?, action? }` → `{ trusted: false }` | live (Task 26) | Forgets one action or the whole project |
| `python.status` | `{ project? }` → `PythonStatusReply` | live (Task 26) | Runtime, `.venv`, `requirements.txt`, aliases |
| `python.venv.create` | `{ project? }` → `{ created, status }` | live (Task 26) | Requires a `venv` trust grant; reply on finish |
| `python.venv.remove` | `{ project? }` → `PythonStatusReply` | live (Task 26) | Removes only the project's `.venv` |
| `python.requirements.install` | `{ project? }` → `{ ok, exitCode, output }` + `python.install` events | live (Task 26) | Requires a `pip` trust grant; streams pip lines |

> **Diagnostics (`app.diagnostics` / `app.share`).** The diagnostics reply is `{ "report": string }`.
> `report` is plain text, already redacted on-device by `core/Redactor.kt`, and covers the device
> model, Android release/SDK/security patch, ABIs, WebView, page size, root status, storage
> free/total, heap limit, the active workspace, installed runtimes and the last crash. The web layer
> appends its recent-error ring and runs its matching `redact()` again before Copy or Share. Copy
> writes that text to the clipboard. Share calls `app.share` with `{ "text": string }`; the host
> redacts it once more and opens the system chooser, replying `{ "shared": boolean }`. The browser
> mock returns `false`, so the web layer falls back to `navigator.share` or Copy.

> **Runtime events and codes.** `runtime.progress` carries `{ phase, bytes, total, message }` with
> phases `preparing`, `download`, `verify`, `extract`, `configure`, `health`, `done`. The terminal
> `runtime.result` is `{ id, ok, code?, message? }`; a failed install reports one of
> `E_BAD_MANIFEST`, `E_INTEGRITY`, `E_HEALTH_CHECK`, `E_OFFLINE`, `E_DISK_FULL`, `E_CANCELLED`,
> `E_NOT_FOUND`, `E_UNSUPPORTED` or `E_INTERNAL`. Installer text is never forwarded (it contains
> app paths and archive names); the event carries fixed copy and the detail is logged with a
> correlation id.
>
> **Manifest signing.** Each `assets/runtime/<id>.json` ships with `<id>.json.sig`, a detached
> Ed25519 signature over the exact manifest bytes. The public key is compiled into the APK
> (`RuntimeKeys`), so replacing the manifest inside a modified APK does not help. CI signs with
> `RUNTIME_SIGNING_KEY` from the protected `python-runtime` environment; `scripts/sign-manifest.sh`
> does the same locally. A manifest whose `versionCode` is below the recorded install is refused
> (rollback protection).

> **Release manifests.** `update.check` fetches `release.json` and `release.json.sig` from
> `BuildConfig.UPDATE_MANIFEST_URL` (default: the latest GitHub release; `LEOCODE_UPDATE_URL`
> overrides it at build time). The signature is Ed25519 over the exact bytes, verified against
> `ReleaseKeys.RELEASE`; the manifest must also match this package and a supported `minSdk`.
> `update.install` re-checks the SHA-256 and size, the APK's package and version code, and the
> APK signer set against the installed app before it opens Android's package installer. A host
> compromise therefore cannot install a different app or a differently signed build, and the user
> still confirms in the system dialog. The installer permission is declared as
> `REQUEST_INSTALL_PACKAGES`; LeoCode never installs silently.

## Git and SSH (Phase F, Tasks 19–23)

Contract commit `c69ff45`. DTOs are in `android/.../bridge/Contract.kt`; the generated TS union is
`web/src/bridge/types.gen.ts`. All `path` values are relative to the active workspace and go
through `PathJail`; `null` means the workspace root. A directory that is not a repository is not an
error: `git.status` returns `initialized: false`.

### Reply payloads

| Type | JSON |
|---|---|
| `GitStatusReply` | `{ initialized, root, branch, head?, upstream?, remote?, ahead, behind, staged[], changed[], untracked[], conflicts[], clean }` |
| `GitFileChange` | `{ path, status, oldPath? }` — `status` is `added`, `modified`, `deleted`, `renamed`, `copied`, `untracked` or `conflicted` |
| `GitCommitReply` | `{ sha, shortSha }` |
| `GitDiffReply` | `{ file?, diff, truncated, binary }` — unified diff, 256 KB default cap (`maxBytes`), binary files return `binary: true` with an empty diff |
| `GitLogReply` | `{ commits: [{ sha, shortSha, author, email, time, message }] }` |
| `GitBranchListReply` | `{ branches: [{ name, current, remote, sha }], current }` |
| `GitRemoteListReply` | `{ remotes: [{ name, url, authKind, username?, hasToken, keyId? }], current? }` — never includes a token |
| `GitSyncReply` | `{ branch, ahead, behind, message }` |
| `GitCancelReply` | `{ cancelled }` |
| `GitConflictReply` | `{ file, merged, ours?, theirs?, base?, binary }` — `merged` keeps standard `<<<<<<<` / `=======` / `>>>>>>>` markers |
| `SshKeyInfo` | `{ id, label, type, fingerprint, comment, hasPassphrase, createdAt, publicKey }` — one OpenSSH **public**-key line |
| `SshKeyListReply` | `{ keys: [SshKeyInfo] }` |
| `SshKnownHostListReply` | `{ hosts: [{ host, port, keyType, fingerprint, addedAt }] }` |
| `SecretHostsReply` | `{ hosts: ["github.com", …] }` — keys only, never values |
| `GitOk` | `{ ok }` |

`auth` is `{ kind: "https" \| "ssh" \| "none", username?, token?, keyId?, passphrase? }`. `token`
and `passphrase` are accepted on the request only. When `auth` is omitted, the stored remote
configuration and `SecretStore` decide; a one-off `auth` is used for that operation and not cached.

### Long operations (clone / fetch / pull / push)

- The reply is sent when the operation **finishes** (success or typed error), not when it starts.
  `git.clone` replies `GitStatusReply`; `git.fetch/pull/push` reply `GitSyncReply`. The client sets
  **no default timeout** for these four methods.
- `git.progress` events are emitted while they run, throttled by the event sink (one per 100 ms per
  event name). `done: 0` / `total: 0` means the phase has not reported a count yet.
- `opId` is generated by the client and must be unique per in-flight operation. A second operation
  with the same `opId` fails with `E_BUSY`.
- `git.cancel { opId }` cancels a running clone/fetch/pull/push. The cancelled request rejects with
  `E_CANCELLED`; cancelling after completion is safe and returns `{ cancelled: false }`.
- Progress is advisory: a throttled or dropped event never changes the outcome. The reply is the
  source of truth.
- `git.pull` and `git.push` map a merge conflict or a rejected non-fast-forward to `E_CONFLICT`.
  Nothing is force-pushed unless `force: true`.

### Host keys and `known_hosts`

- On an unknown host the host emits `ssh.hostkey.prompt` and **blocks that Git operation** until
  `ssh.hostkey.answer`, or for **120 s**, after which the operation fails with `E_AUTH` ("host key
  was not confirmed").
- `trust: true` accepts the key for this connection; `remember: true` (the default) also writes it
  to `known_hosts`. `trust: false` fails the operation with `E_AUTH` ("host key rejected").
- `promptId` is single-use and request-scoped. Answering an expired or unknown prompt returns
  `E_NOT_FOUND`; it never trusts a key.
- A known host that presents a **different** key produces **no prompt**: the operation fails with
  `E_HOSTKEY_CHANGED`, naming the host and port. The user must forget the host (`ssh.hostkey.delete
  { host, port }`, available in SSH keys) and connect again. This is deliberate: a silent
  re-prompt is exactly the behaviour a MITM benefits from.
- `known_hosts` is OpenSSH-compatible: one `host keytype base64` line per key, `[host]:port` for
  non-22 ports, no duplicate lines, atomic writes. It lives in `filesDir/ssh/`, the raw file is
  never returned to the WebView, and unrelated OpenSSH entries are preserved. `ssh.hostkey.list`
  returns host/port/key type/SHA-256 fingerprint only. Fingerprints match `ssh-keygen -l`.
- The 120 s wait is host-side; `ssh.hostkey.answer` itself has no client timeout. Closing the sheet
  does not cancel the Git operation, so the prompt can be answered late (until the timeout or
  `git.cancel`).

### Security

- No token, private key or passphrase returns to the WebView, appears in a reply/event/error, or is
  written to logcat. `git.remote.list` exposes `hasToken` only; `ssh.keys.list` exposes public data
  only; no method exports private key material.
- Tokens and private keys are stored as Keystore-wrapped ciphertext under `filesDir/secrets/` and
  `filesDir/ssh/` (D-009/D-016). A secret is decrypted for the operation that needs it and is never
  cached in a static field.
- URLs are sanitised (userinfo removed) before any diagnostic or progress message.
- The WebView may send a token/passphrase once (remote setup, a protected-key unlock, or a one-off
  `auth`); the host stores or uses it for that operation only.

### Error mapping (Git/SSH network operations)

| Cause | Code |
|---|---|
| Bad token, wrong key/passphrase, rejected host key | `E_AUTH` |
| DNS, connect, TLS or socket timeout | `E_OFFLINE` |
| Merge conflict, non-fast-forward, dirty checkout | `E_CONFLICT` |
| Changed host key (`known_hosts` mismatch) | `E_HOSTKEY_CHANGED` |
| Cancelled by `git.cancel` | `E_CANCELLED` |
| Two operations with one `opId` | `E_BUSY` |
| Anything else | `E_IO` (plain message, no exception text) |

Messages are plain language: no exception class names, stack traces, URLs with userinfo, or key
material. `E_INTERNAL` keeps its correlation id.

## Events

| Event | Payload | Source |
|---|---|---|
| `proc.stdout`, `proc.stderr` | `{ data }` | `proc.run` |
| `proc.exit` | `{ code, signal? }` | `proc.run` |
| `term.data` | `{ b64 }` (base64) | `term.open` / `term.attach` |
| `term.exit` | `{ code }` | terminal session |
| `search.match` | `{ path, line, col, preview }` | `fs.search` |
| `git.progress` | `{ op, opId?, task, done, total }` — `op` is `clone`, `fetch`, `pull` or `push` | `git.clone/fetch/pull/push` |
| `ssh.hostkey.prompt` | `{ promptId, host, port, keyType, fingerprintSha256, changed, previousFingerprint? }` | SSH connect; blocks until `ssh.hostkey.answer` or 120 s |
| `runtime.progress` | `{ phase, bytes, total }` | `runtime.install` |
| `update.progress` | `{ phase, bytes, total }` — `download`, `verify` or `install` | `update.install` |
| `update.result` | `{ ok, code?, message? }` | `update.install` |
| `saf.progress` | `{ phase: "import" \| "export" \| "restore", files, bytes }` | `saf.importTree` / `saf.exportWorkspace` / `saf.restoreArchive` |
| `app.lowMemory` | `{}` | `onTrimMemory` |
| `app.restored` | `{ reason: "renderer" \| "crash" }` | Task 8 — shows the "Restored after a problem" banner |
| `root.lost` | `{ sessionId?, jobId?, reason }` | Sent on the stream of the root terminal session or root job it concerns, when `su` refuses a new root operation (`denied`) or the grant is gone (`revoked`). A root shell that is already running keeps uid 0 after a revoke in Magisk; the loss shows up on the next root operation. |

## Versioning

Additive changes keep `v: 1`. Breaking changes bump to `v: 2` and the Kotlin host serves both for
one release. The generated `web/src/bridge/types.gen.ts` is committed and checked in CI
(`git diff --exit-code` after `./gradlew :app:generateBridgeTypes`).
