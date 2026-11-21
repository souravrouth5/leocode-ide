# Task 14–16 verification — workspaces, editor completeness, workspace search

**Date:** 2026-11-14
**Scope:** Plan v9 Phase D (`docs/LeoCode_Implementation_Plan_v9.md`).
**Status:** code complete; JVM + web gates green; **no device run yet**.

## What shipped

### Task 14 — workspaces, SAF import/export, zip backup, uninstall warning

- `core/Workspace.kt` stays the app-private layout; the new
  `workspace/WorkspaceStore.kt` owns a registry (`filesDir/workspaces.json`), the
  active workspace id and one directory per workspace under
  `workspace/workspaces/<id>`. `default` cannot be deleted; deleting another
  workspace moves its directory to `Trash`.
- `bridge/WorkspaceHandler.kt` implements `workspace.list/create/open/rename/delete`.
  `list` replies `{ active, workspaces }` so the web switcher can restore the
  active root after a restart; `rename` changes the display name only.
- `FsHandler` resolves relative paths against the **active** workspace and
  protects every workspace root (including the active one) from writes outside
  the jail.
- `bridge/SafHandler.kt` + `SafPort.kt` implement:
  - `saf.importTree` — folder copy-in, never overwriting an existing name;
  - `saf.exportWorkspace` — streaming zip copy-out of the active workspace;
  - `saf.restoreArchive` — strict restore (safe entry names, per-entry and total
    size caps, file-count cap) that streams each entry to a unique temp file and
    moves it into place atomically.
  All three emit `saf.progress { phase, files, bytes }`.
- Web: `features/workspace/workspaceStore.ts`, `WorkspaceSwitcher` in the top bar,
  Settings → Backup & Import (import folder, export backup, restore backup) with
  progress text, plus the uninstall warning. Switching a workspace clears open
  tabs and re-lists the explorer from `.`.

### Task 15 — drafts, external changes, large files, find/replace

- `core/FileHash.kt` (SHA-256, bounded variant) and
  `workspace/Drafts.kt` (drafts outside the workspace tree, at
  `filesDir/drafts/<workspaceId>/<sha256(path)>.json`).
- `bridge/FsHandler.kt`: `fs.stat`, chunked `fs.read` (`offset`, `maxBytes`,
  `nextOffset`, `mtime`, `hash`), and `expectedHash` on `fs.write` → `E_CONFLICT`.
  `ReadReply.size` is a `Long`.
- `bridge/DraftHandler.kt`: `draft.list/read/save/delete`, 4 MB cap.
- Web editor:
  - `draft.save` three seconds after typing stops; recovery banner with
    **Restore** / **Discard**; drafts deleted on a successful save or tab close;
  - external-change polling (`fs.stat` every 5 s while the editor is visible)
    with **Reload** / **Keep mine**; Keep mine refreshes the baseline and a
    deleted file is recreated on the next save;
  - files above 1 MB open in read-only large-file mode with the first 1 MB
    loaded; save is disabled so a truncated buffer is never written;
  - a custom find/replace sheet drives CodeMirror `SearchQuery` /
    `findNext` / `replaceNext` / `replaceAll` through editor commands, with
    case and regular-expression options.

### Task 16 — workspace search

- `workspace/SearchEngine.kt` walks the active workspace, ignores `.git`,
  `node_modules`, `.venv` and `__pycache__`, applies a `*`/`?`/`**` glob,
  is case-insensitive by default, and caps results (default 500, max 2 000).
- `bridge/SearchHandler.kt` streams `search.match { path, line, col, preview }`
  and ends with `{ count, truncated }`; `fs.search.cancel` cancels by a
  client-generated `searchId`.
- Web: `features/search/searchStore.ts` + `components/SearchPanel.tsx`; results
  stream in incrementally, the sheet can cancel, and a row opens the file and
  dispatches `gotoPosition`.

## Tests added

| Layer | File | Covers |
|---|---|---|
| JVM | `core/FileHashTest.kt` | full/bounded SHA-256 |
| JVM | `workspace/WorkspaceStoreTest.kt` | create/open/rename/delete, default protection, recents |
| JVM | `workspace/DraftsTest.kt` | save/list/read/delete, caps, workspace isolation |
| JVM | `workspace/SearchEngineTest.kt` | match/case/glob/ignore/cap/cancel fixture tree |
| JVM | `workspace/ZipBackupTest.kt` | export/restore round-trip, overwrite, traversal/absolute rejection |
| JVM | `bridge/WorkspaceHandlerTest.kt` | `workspace.*` routing and replies |
| JVM | `bridge/DraftHandlerTest.kt` | `draft.*` routing, validation |
| JVM | `bridge/SearchHandlerTest.kt` | streamed matches, summary, cancel |
| JVM | `bridge/SafHandlerTest.kt` (expanded) | import/export/restore + progress + limits |
| Web | `bridge/mock.phaseD.test.ts` | stat/chunk/compare-and-swap, workspace lifecycle, drafts, search stream/cap/cancel, import/export/restore |
| Web | `features/workspace/workspaceStore.test.ts` | load/create/switch/rename/delete, buffer reset, confirmations |
| Web | `features/search/searchStore.test.ts` | streaming, empty query, cancel before restart, jump-to-line |
| Web | `features/editor/editorPhaseD.test.ts` | large-file mode, draft autosave/recovery/discard, external change/conflict/keep-mine, find/replace commands |

## Gates

| Command | Result |
|---|---|
| `./gradlew testDebugUnitTest` | **PASS** — 252 tests |
| `./gradlew generateBridgeTypes` | **PASS** — generated file up to date |
| `cd web && npm test` | **PASS** — 37 files, 224 tests |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** (existing chunk-size warning only) |

## Bugs found and fixed

1. `ReadReply.size` was `Int`; the host's byte sizes are `Long`.
2. `ZipBackup.restore` truncated every restored file by one buffered block
   because the buffered output stream was never closed. Restore now streams into
   a unique `.tmp` file and moves it into place atomically.
3. A closed `Sheet` stayed in the accessibility tree, producing a duplicate
   `role="status"` in tests and for screen readers.
4. **Keep mine** stored `saved: null`, which made Save run the Save As prompt.
   Save now keys the prompt on `isUntitled` only; Keep mine against a deleted
   file clears the baseline so Save recreates it.

## Known limits / follow-ups

- `fs.stat`/`fs.read` hash the whole file, including the large-file path. This
  is fine for typical source files but should become a bounded/streamed hash if
  multi-megabyte files become common (also noted as W-25).
- Draft autosave is intentionally skipped for untitled, SAF and large/read-only
  documents.
- Restore merges into the active workspace and replaces same-named files; it is
  not a transactional rollback of the whole workspace.
- Device rows in `docs/test-matrix.md` § Workspace and editor (Tasks 14–16)
  remain pending: both phones were unavailable for this session.
