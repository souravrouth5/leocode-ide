# Phase D review fixes — PD-01…PD-25

**Date:** 2026-11-15 · **Branch:** `v9-impl` · **Review:** [`phase-d-analysis.md`](phase-d-analysis.md)
**Scope:** every finding in the Phase D review except the two items explicitly deferred below.

## Commits

The fixes were developed in four worktrees so Android and web work could proceed without file
collisions, then merged one branch at a time.

| Branch | Commit | Theme |
|---|---|---|
| Web search/mock | `9f14602` | Stale search guard, late-search cancel, mock parity, jump handshake |
| Web editor/dialogs | `aba9ff5` | In-app dialogs, Save As guard, session tagging, draft locks, backup banner |
| Android core | `b729f11` | Registry quarantine, backup hardening, search caps/locale, SAF guard/lock |
| Android platform | `9bd2d57` | Import staging, scratch sweeps, progress throttle, stat hash cache |
| Merges | `a4480ca`, `136751f`, `bc10d54`, `a021d50` | One merge commit per branch |
| Follow-up | `8eceac6` | Mock `mkdir` aligned with the host's `mkdirs()` (found during merge review) |

## Gates on the merged tree

| Check | Result |
|---|---|
| Android `testDebugUnitTest` | **302 tests**, 0 failures / 0 errors / 0 skipped |
| Android `lintDebug` | **PASS** |
| Web `typecheck` | **PASS** |
| Web `lint` | **PASS** |
| Web `npm test` | **255 tests** in 38 files, 0 failures |
| Web `npm run build` | **PASS** (only the existing chunk-size warning) |

Baselines before the fixes: 252 Android tests, 224 web tests. Three React tests
(`editorPanes`, `shell` smoke, `?simulate` surfaces) are timing-sensitive under a fully
loaded 4-core machine and failed intermittently during parallel Gradle runs; each passed
alone and the final clean run on an idle machine was green.

## Findings

| ID | Status | Fix |
|---|---|---|
| PD-01 | Fixed | `readIndex()` distinguishes "missing" (empty index) from "unparseable" (null). A corrupt index is renamed to `workspaces.json.corrupt-<ms>` **before** anything is written; if the rename fails startup fails instead of overwriting user data. Valid directories under `workspacesRoot` are re-registered, so no project disappears. |
| PD-02 | Fixed (design deviation) | All nine `window.confirm`/`window.prompt` call sites now use an in-app dialog store + `DialogHost` sheet (focus, Enter/Escape, validation, danger styling, back-button dismissal). A new scan test fails if native JS dialogs reappear in production sources. |
| PD-03 | Fixed | `beginSaveAs()`/`saveAs()` refuse a `large`/`readOnly` document with a notification explaining that only the first chunk is loaded, so Save As cannot write a truncated copy. |
| PD-04 | Fixed | `searchStore.search` captures its id; stale matches, stale summaries and stale errors are ignored, and a real error from the current search is still reported. |
| PD-05 | Fixed (both halves) | Host `SearchHandler` batches matches into `search.matches` JSON arrays every 64 (flushed before the reply); `BridgeHost` throttles `*.progress` events to one per 100 ms per name. The web client fans arrays out and still accepts single `search.match` events. |
| PD-06 | Fixed | Imports copy into `workspace.tmp/import-<uuid>` and only then commit (rename the tree, or move children into an existing destination with unique names). Any failure deletes staging and leaves the workspace untouched. Caps throw `IllegalStateException` with fixed reasons; `SafHandler` maps them to `E_LIMIT` and passes the reason through. Depth > 64 is an error instead of a silent truncation. |
| PD-07 | Fixed | A failed SAF archive copy deletes its `restore-*.zip`. `ScratchSweeper` (1 h TTL, injectable clock) runs on the existing background reaper thread in `LeoApp.onCreate` and removes stale `cacheDir/restore-*`, `workspace.tmp/backup-*` and `workspace.tmp/import-*`. |
| PD-08 | Fixed (deviation) | Export skips symlinks (and canonical paths that escape the root) instead of aborting, counts them in `BackupResult.skipped`, and enforces 20 000 files / 1 GiB. Generated directories are still exported: silently dropping `node_modules` or `build` from a user's backup is worse than a bounded failure. |
| PD-09 | Fixed | `WorkspaceHandler` takes `Drafts` and purges `drafts/<id>/` after a successful delete; `Drafts.deleteWorkspace` also removes the now-empty directory. |
| PD-10 | Fixed | Search uses `indexOf(query, start, ignoreCase)` on the original line, so Turkish-locale lowercasing and length-changing case folds cannot move `col`; ordering and next-match start are preserved. |
| PD-11 | Fixed | The session is tagged with the workspace id; `clearWorkspace()` suppresses the persist it triggers; `restoreSession()` refuses a session from another workspace and restores it when the user switches back. `Shell` loads the workspace registry before restoring so the id is known. Deleting the active workspace forgets its stored session so the fallback can restore its own. |
| PD-12 | Fixed | `fs.stat` reuses a SHA-256 while `(size, mtime)` are unchanged, in a 64-entry access-ordered LRU keyed by canonical path; every mutating `fs` operation clears it. Hash function is injectable. |
| PD-13 | Fixed | A timed-out or post-send-aborted `fs.search` sends `fs.search.cancel` with the request's `searchId` (including for late replies), so the host stops walking. |
| PD-14 | Fixed | A successful switch (and deletion of the active workspace) dispatches `leocode:workspace-switched`; search and find/replace both reset their state and cancel a running search. |
| PD-15 | Fixed | `maxResults <= 0` → 500, hard-capped at 2 000; `truncated` is true only when a real match beyond the cap was dropped; cancellation reports false. Host and mock agree. |
| PD-16 | Fixed | Mock glob semantics (trim, basename vs path), the full host ignore list, `fs.read`'s 4 MB cap, idempotent `mkdir` on directories, `mkdirs()` ancestor creation, and cancel/truncated semantics all match the host. |
| PD-17 | Fixed | `jump()` dispatches `gotoPosition` with a token and retries every 50 ms (up to 20) until `EditorPane` acknowledges with `leocode:editor-command-ack`; a missing pane produces a notification instead of a silent no-op, and a line beyond a large-file chunk is reported rather than "jumped to". |
| PD-18 | Fixed | `saf.restoreArchive` rejects anything but `confirm == true` with `E_BAD_ENVELOPE` before touching the port. |
| PD-19 | Fixed | One `AtomicBoolean` covers import/export/restore and answers `E_BUSY`; it is released exactly once on every reply path and on synchronous exceptions. Single-document `saf.open`/`saf.save` stay unlocked. |
| PD-20 | **Partially fixed** | Orphan adoption, corrupt-index/quarantine recovery, and `create`/`open` rollback are in. The startup scratch sweep runs off the main thread. `workspace.ensure()` itself remains synchronous by design (see below). |
| PD-21 | Fixed | Export copy-out progress reports the archived file count with the copied bytes instead of `0 files`. |
| PD-22 | Fixed | Restore stages each entry under `scratchDir`, then moves it into place (`REPLACE_EXISTING`, streamed-copy fallback for cross-device/atomic-move failures) and always deletes the temp; no `.tmp` remains in the workspace. |
| PD-23 | Fixed | Mock draft `size` is character length, matching the host. |
| PD-24 | Fixed | Draft operations are serialized per path (sorted multi-path locks). `renamePath` clears the old autosave timer and runs read→save→delete under both paths' locks, so an autosave cannot recreate the old draft or leave stale content at the new path. |
| PD-25 | **Partially fixed** | Import/export/restore status moved to a `backupStore` and a persistent `BackupProgressBanner` in `Shell` that survives closing Settings. There is no cancel button because the host exposes no cancellation for `saf.*` heavy work. |

## Deferred and partial items

1. **PD-20 — async `ensure()`.** The registry work stays on the main thread because `MainActivity`
   assumes the active workspace is ready at first frame. It is now failure-resilient (quarantine,
   adoption, rollback) and the expensive scratch sweep runs on the background reaper thread.
   Moving `ensure()` fully async needs a readiness state in `AppGraph`; deferred to its own task.
2. **PD-25 — cancellation.** Visibility is fixed; cancelling an in-flight import/restore needs a
   host-side cancel API (the SAF copy loop has no cancellation token). Deferred.
3. **PD-16 — `mkdir` parent semantics.** Fixed in the merge follow-up (`8eceac6`): the mock now
   creates ancestors like the host's `mkdirs()`.
4. **Device-dependent checks.** PD-02 on the real WebView (dialogs now in-app), PD-05 jank on a long
   import, PD-12 battery/heat over a 10-minute session, PD-01/PD-20 corrupt-index recovery after a
   forced kill, PD-06 partial-import rollback with a revoked provider, and PD-07/PD-22 kill-during-
   restore still need the D1/D2 pass. The unit suites cover the logic; the SAF Activity wiring is
   compile- and lint-verified only (no Robolectric).

## Deviations and residual risks

- **PD-02** was implemented as an in-app dialog store rather than a native `onJsPrompt`/`onJsConfirm`
  bridge. This keeps the web UI consistent on both platforms and needs no new bridge methods.
- **PD-08** still archives generated directories; the 20 000 file / 1 GiB caps turn a runaway
  workspace into an `E_IO` failure with a clear message instead of a multi-GB zip.
- **PD-11** keeps a single persisted session slot. While one workspace is active, its session is
  the one stored; a session from the workspace just left survives until tabs are opened in the new
  one. Deleting the active workspace now removes its dead session.
- **PD-12** trusts `(size, mtime)`; content replaced while preserving both is not detected (a normal
  external edit moves the mtime).
- The restore move is atomic only within one filesystem; the cross-device fallback is a streamed
  copy and is exercised only by unit tests on one filesystem.
- `SafHandler.safError` now maps `IllegalStateException` to `E_LIMIT` with its message. Only the
  import budget throws that type today; any future misuse would surface its text to the UI.
