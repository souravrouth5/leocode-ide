# LeoCode Bridge Contract — v1 (draft)

Transport: `WebViewCompat.addWebMessageListener` on the single allowed origin produced by
`WebViewAssetLoader` (`https://appassets.androidplatform.net`). `addJavascriptInterface` is
forbidden. Kotlin models are `@Serializable`; TypeScript types are generated, never hand-written.

## Envelope

```jsonc
// request  (TS → Kotlin)
{ "v": 1, "id": "42", "method": "fs.read", "payload": { "path": "src/main.py" } }

// reply    (Kotlin → TS) exactly one per request
{ "v": 1, "id": "42", "ok": true,  "payload": { "content": "..." } }
{ "v": 1, "id": "42", "ok": false, "error": { "code": "E_PATH_OUTSIDE_ROOT", "message": "…" } }

// event    (Kotlin → TS) zero or more per request
{ "v": 1, "id": "42", "event": "proc.stdout", "payload": { "data": "..." } }
```

Rules
- `id` is unique per request and echoed in replies/events.
- Max message size 256 KB. Large reads are chunked (`fs.read` returns `nextOffset`).
- Terminal output is coalesced at 16 ms and gated by `term.ack` (backpressure).
- Unknown `method` → `E_UNKNOWN_METHOD`. Malformed envelope → `E_BAD_ENVELOPE`, connection kept.
- Every path argument is canonicalised, symlinks resolved, and must remain under the workspace root.

## Error codes

| Code | Meaning |
|---|---|
| `E_BAD_ENVELOPE` | Malformed JSON or missing fields |
| `E_UNKNOWN_METHOD` | Method not in the allowlist |
| `E_PATH_OUTSIDE_ROOT` | Path escaped the workspace after canonicalisation |
| `E_NOT_FOUND` | File/workspace/runtime missing |
| `E_EXISTS` | Target already exists |
| `E_PERMISSION` | Android permission or SAF denial |
| `E_NO_RUNTIME` | Requested runtime not installed |
| `E_AUTH` | Git/SSH authentication failed |
| `E_HOSTKEY_CHANGED` | Host key mismatch — requires explicit user action |
| `E_LIMIT` | Process/memory/output limit hit |
| `E_BUSY` | Operation already running for this resource |
| `E_IO` | Filesystem/network failure |
| `E_INTERNAL` | Unexpected; logged with a correlation id, no secrets |

## Methods (v1)

| Method | Payload → Reply | Notes |
|---|---|---|
| `app.info` | `{}` → `{ version, webview, abi, androidSdk }` | Used by degraded-mode detection |
| `workspace.list` | `{}` → `[{ id, name, path, lastOpened }]` | |
| `workspace.create` | `{ name }` → `{ id, path }` | |
| `workspace.open` | `{ id }` → `{ id, path }` | |
| `fs.list` | `{ path }` → `[{ name, path, kind, size, mtime }]` | No recursion |
| `fs.read` | `{ path, offset?, maxBytes? }` → `{ content, nextOffset }` | UTF-8 only; binaries rejected |
| `fs.write` | `{ path, content, atomic=true }` → `{}` | temp → fsync → rename |
| `fs.mkdir` | `{ path }` → `{}` | |
| `fs.rename` | `{ from, to }` → `{}` | |
| `fs.delete` | `{ path }` → `{}` | Moves to workspace trash |
| `fs.search` | `{ query, glob?, maxResults? }` → event stream `fs.match` | Ignores `.git`, `node_modules`, `.venv` |
| `term.open` | `{ cwd, cols, rows }` → `{ sessionId }` | Spawns PTY |
| `term.write` | `{ sessionId, data }` → `{}` | |
| `term.resize` | `{ sessionId, cols, rows }` → `{}` | SIGWINCH |
| `term.close` | `{ sessionId }` → `{}` | Kills the process group |
| `term.ack` | `{ sessionId, bytes }` → `{}` | Backpressure credit |
| `proc.run` | `{ cwd, argv[], env?, timeoutMs? }` → `{ jobId }` | Event stream `proc.stdout/stderr/exit` |
| `proc.cancel` | `{ jobId }` → `{}` | SIGTERM → SIGKILL on the group |
| `git.*` | see `docs/git-ops.md` (Phase 3) | `clone/status/add/commit/diff/log/branch/checkout/pull/push` |
| `ssh.*` | see `docs/ssh-ops.md` (Phase 3) | `keys.generate/import/list`, `hostkey.trust` |
| `runtime.*` | `{ id }` → catalogue/install/progress/uninstall | Manifest-verified |

## Events

`proc.stdout`, `proc.stderr`, `proc.exit`, `term.data`, `term.exit`, `runtime.progress`,
`git.progress`, `search.match`, `app.lowMemory`.

## Versioning

Additive changes keep `v: 1`. Breaking changes bump to `v: 2` and the Kotlin host serves both for
one release. The generated `web/src/bridge/types.gen.ts` is committed and checked in CI.
