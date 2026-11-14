# LeoCode Bridge Contract — v1 (draft, updated for plan v9)

Transport: `WebViewCompat.addWebMessageListener` on the single allowed origin produced by
`WebViewAssetLoader` (`https://appassets.androidplatform.net`). Debug builds may also allow the
Vite dev origin. `addJavascriptInterface` is forbidden. Kotlin models are `@Serializable`;
TypeScript types are generated into `web/src/bridge/types.gen.ts`, never hand-written (Task 7).

Status markers in the method table: **live** = implemented today (in `WebAppBridge.kt`, moving to
handlers in Tasks 5–6), **planned** = added by the v9 task named.

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
- **Size limits:** max incoming message 256 KB (`E_LIMIT`). `fs.read` returns at most `maxBytes`
  (default 512 KB) and a `nextOffset` for chunked reads; files above 2 MB require chunking.
  `fs.write` content max 4 MB. SAF reads are capped the same way.
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
  the WebView.

## Timeouts (client defaults)

The client (Task 11) rejects with `E_TIMEOUT` if no reply arrives in time and drops late replies.
Any request can be cancelled with an `AbortSignal` → `E_CANCELLED`.

| Class | Methods | Default |
|---|---|---|
| Fast | `app.*`, `fs.list/read/mkdir/rename/delete`, `term.write/resize/ack`, `root.status` | 10 s |
| Write | `fs.write`, `workspace.*` | 20 s |
| User-wait | `saf.*`, `storage.requestPermission`, `root.request`, `ssh.hostkey.answer` | none (user-driven; cancellable) |
| Long, streamed | `proc.run`, `fs.search`, `git.clone/fetch/pull/push`, `runtime.install` | reply on start within 10 s; then events, no overall timeout |

If the host stops answering entirely (WebView detached, renderer restarted), every pending
request rejects with `E_BRIDGE_DISCONNECTED` (web side only).

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
| `app.info` | `{}` → `{ version, webview, abi, androidSdk, pageSize, rooted }` | live (fields added in Task 17) | Used by degraded-mode detection and diagnostics |
| `app.theme.get` / `app.theme.set` | `{ mode? }` → `{ mode, effective }` | live | Syncs system bars |
| `app.diagnostics` | `{}` → `{ report }` | planned (Task 27) | Redacted text report |
| `storage.info` | `{}` → `{ hasPermission, internalStorage, downloads, documents, workspace }` | live | Shape kept from v0; Task 27 may extend |
| `storage.requestPermission` | `{}` → `{ granted }` | live | User-wait |
| `saf.open` | `{ mime? }` → `{ name, uri, content, size }` (or `null` on cancel) | live | Copy-in; 4 MB cap |
| `saf.save` | `{ name, content }` → `{ name, uri }` (or `null` on cancel) | live | Copy-out; 4 MB cap |
| `saf.importTree` / `saf.exportWorkspace` | `{ … }` → event stream `saf.progress` | planned (Task 14) | Folder copy-in, zip export |
| `workspace.list` | `{}` → `[{ id, name, path, lastOpened }]` | planned (Task 14) | |
| `workspace.create` | `{ name }` → `{ id, path }` | planned (Task 14) | |
| `workspace.open` | `{ id }` → `{ id, path }` | planned (Task 14) | |
| `workspace.rename` | `{ id, name }` → `{}` | planned (Task 14) | |
| `workspace.delete` | `{ id }` → `{}` | planned (Task 14) | Confirmation in UI; moves to trash |
| `fs.list` | `{ path }` → `[{ name, path, kind, size, mtime }]` | live | No recursion |
| `fs.read` | `{ path, offset?, maxBytes? }` → `{ content, nextOffset, mtime, hash }` | live (chunking + hash in Task 15) | UTF-8 only; binaries → `E_BINARY` |
| `fs.write` | `{ path, content, expectedHash? }` → `{ mtime, hash }` | live (atomic since Task 4; `expectedHash` Task 15) | temp → fsync → rename; mismatch → `E_CONFLICT` |
| `fs.mkdir` | `{ path }` → `{}` | live | |
| `fs.rename` | `{ from, to }` → `{}` | live | |
| `fs.delete` | `{ path }` → `{}` | live | Moves to trash, never silent permanent delete |
| `fs.search` | `{ query, glob?, maxResults? }` → event stream `search.match`, then `{ count, truncated }` | planned (Task 16) | Ignores `.git`, `node_modules`, `.venv`; cancellable |
| `term.open` | `{ cwd, cols, rows, root? }` → `{ sessionId, pid }` | live (`root` Task 18) | Spawns the PTY (or `su` in PTY) and attaches this request's stream; the reply is sent before the first `term.data` |
| `term.attach` | `{ sessionId }` → `{ sessionId, scrollback, alive, exitCode }` then `term.data` events | live (Task 10) | Replays the ring-buffer scrollback, then streams live output; a session that exited while detached is removed, so attach returns `E_NOT_FOUND` and the page opens a new terminal |
| `term.list` | `{}` → `[{ sessionId, root, alive, title, pid, cwd }]` | live (Task 10) | Sessions survive Activity/WebView recreation via `SessionService` |
| `term.write` | `{ sessionId, b64 }` → `{ accepted }` | live | base64 bytes |
| `term.resize` | `{ sessionId, cols, rows }` → `{ ok }` | live | SIGWINCH |
| `term.ack` | `{ sessionId, bytes }` → `{ ok }` | live (Task 6) | Backpressure credit; 256 KB window |
| `term.close` | `{ sessionId }` → `{ closed }` | live | Kills the process group (via `su` for root sessions) |
| `proc.run` | `{ cwd, argv[], env?, timeoutMs?, root? }` → `{ jobId, pid }` | live (`root` Task 18) | Events `proc.stdout/stderr/exit`; env keys allowlisted; no timeout by default |
| `proc.cancel` | `{ jobId }` → `{}` | live (grace period Task 6) | SIGTERM → 2 s → SIGKILL on the group |
| `root.status` | `{}` → `{ available, granted, enabled }` | planned (Task 17) | Never prompts |
| `root.request` | `{}` → `{ granted }` | planned (Task 17) | User-wait; `E_ROOT_UNAVAILABLE` / `E_ROOT_DENIED` |
| `git.init` / `git.clone` | `{ path }` / `{ url, path, auth? }` → `{}` | planned (Tasks 21–22) | Clone emits `git.progress`; cancellable |
| `git.status` | `{ repo }` → `{ branch, staged[], changed[], untracked[], conflicts[] }` | planned (Task 21) | |
| `git.add` / `git.reset` | `{ repo, paths[] }` → `{}` | planned (Task 21) | |
| `git.commit` | `{ repo, message, author? }` → `{ sha }` | planned (Task 21) | |
| `git.diff` | `{ repo, path?, staged? }` → `{ hunks[] }` | planned (Task 21) | |
| `git.log` | `{ repo, max? }` → `[{ sha, author, time, message }]` | planned (Task 21) | |
| `git.branch.list/create/delete`, `git.checkout` | `{ repo, … }` → `{}` | planned (Task 21) | |
| `git.fetch` / `git.pull` / `git.push` | `{ repo, remote?, auth? }` → `{}` | planned (Task 22) | `git.progress`; `E_AUTH`, `E_OFFLINE`, `E_CONFLICT` |
| `git.resolve` | `{ repo, path, choices[] }` → `{}` | planned (Task 22) | Accept ours/theirs per block |
| `ssh.keys.list` | `{}` → `[{ id, type, fingerprint, comment, hasPassphrase }]` | planned (Task 23) | Public data only |
| `ssh.keys.generate` | `{ type: "ed25519"\|"rsa", comment, passphrase? }` → `{ id, publicKey }` | planned (Task 23) | |
| `ssh.keys.import` | `{ content, passphrase? }` → `{ id, fingerprint }` | planned (Task 23) | OpenSSH, PEM, PKCS#8; content discarded after import |
| `ssh.keys.delete` | `{ id }` → `{}` | planned (Task 23) | |
| `ssh.hostkey.answer` | `{ promptId, trust: boolean }` → `{}` | planned (Task 23) | Answers an `ssh.hostkey.prompt` event |
| `secrets.token.set/delete/list` | `{ host, token? }` → `{}` / `[{ host }]` | planned (Task 20) | Token never returned to the WebView |
| `runtime.catalog` | `{}` → `[{ id, version, size, installed, healthy }]` | planned (Task 25) | Manifest-verified |
| `runtime.install` | `{ id }` → event stream `runtime.progress`, then `{ id, installed }` | live (bundled installer; Task 25 replaces it) | `E_BUSY` while an id is installing |
| `runtime.cancel` | `{ id }` → `{ cancelling }` | live | Flags the running install; polled between chunks |
| `runtime.uninstall` / `runtime.repair` | `{ id }` → `{}` | planned (Task 25) | |
| `language.list` | `{}` → `[{ id, name, extensions[], runtimeId, hasRepl, template }]` | planned (Task 30) | Language providers (D-017); Python is the first |
| `trust.check` / `trust.grant` | `{ project, action }` → `{ trusted }` | planned (Task 26) | Scripts, pip, venv, Git hooks |

> **Runtime prototype codes.** The Python installer prototype (commit `1a279a2`) emits `E_BAD_MANIFEST`, `E_INTEGRITY` and `E_HEALTH_CHECK`. They are not in the table above yet. Task 25 decides whether to add `E_INTEGRITY` and `E_HEALTH_CHECK` to the `ErrorCode` enum (and the catalog) or map them onto existing codes. `runtime.install` must reply within 10 s and then stream `runtime.progress` events (see Timeouts).

## Events

| Event | Payload | Source |
|---|---|---|
| `proc.stdout`, `proc.stderr` | `{ data }` | `proc.run` |
| `proc.exit` | `{ code, signal? }` | `proc.run` |
| `term.data` | `{ b64 }` (base64) | `term.open` / `term.attach` |
| `term.exit` | `{ code }` | terminal session |
| `search.match` | `{ path, line, col, preview }` | `fs.search` |
| `git.progress` | `{ task, done, total }` | Git network ops |
| `ssh.hostkey.prompt` | `{ promptId, host, keyType, fingerprintSha256 }` | SSH connect; waits for `ssh.hostkey.answer` |
| `runtime.progress` | `{ phase, bytes, total }` | `runtime.install` |
| `saf.progress` | `{ files, bytes }` | import/export |
| `app.lowMemory` | `{}` | `onTrimMemory` |
| `app.restored` | `{ reason: "renderer" \| "crash" }` | Task 8 — shows the "Restored after a problem" banner |
| `root.lost` | `{ sessionId? }` | Task 18 — grant revoked mid-session |

## Versioning

Additive changes keep `v: 1`. Breaking changes bump to `v: 2` and the Kotlin host serves both for
one release. The generated `web/src/bridge/types.gen.ts` is committed and checked in CI
(`git diff --exit-code` after `./gradlew :app:generateBridgeTypes`).
