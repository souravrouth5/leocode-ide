# Phase D analysis report: bugs and edge cases (Tasks 14–16)

**Date:** 2026-11-14 · **Branch:** `v9-impl` at `9c6dc72` · **Scope:** `git show 9c6dc72` (60 files, +6 751 / −115), plan v9 Tasks 14–16
**Audience:** the next AI model or person who will fix these before the Python phase. This file is self-contained. The implementation facts (gates, already-fixed bugs, known limits) are in [`task14-16-verification.md`](task14-16-verification.md); this report is only new problems found by re-reading the merged code.

---

## 1. Verdict

**Solid on the JVM, fragile at the edges.** The pure-JVM services (`WorkspaceStore`, `Drafts`, `SearchEngine`, `ZipBackup`) are genuinely safe: the path jail holds, restore is zip-slip-proof with per-entry and total caps, writes are atomic, and the editor's optimistic-concurrency loop (`expectedHash` → `E_CONFLICT`) protects every save. What is missing is what surrounds them: the workspace registry silently self-destructs on a corrupt index, the heavy SAF flows leave partial state behind on failure, progress/search events flood the WebView uncoalesced, and one device-level gap (`window.prompt`/`window.confirm` are no-ops in an unpatched WebView) makes several Phase D UIs unreachable on a phone.

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 12 |
| Low | 11 |
| **Total** | **25** |

Everything device-dependent is tagged SUSPECTED; D1/D2 were not connected during this review.

---

## 2. Fix first (P1)

### PD-01 · A corrupt `workspaces.json` silently resets the registry — then the old file is overwritten — CONFIRMED
`WorkspaceStore.readIndex` catches `SerializationException`/`IOException` and returns a fresh empty index; `ensure()` then persists that default-only index immediately, destroying the only copy of the registry. Every user workspace except `default` becomes unopenable through the UI (the directories still exist under `filesDir/workspaces/<id>`, but nothing lists them and nothing re-registers them). One bad write — kill during `AtomicWriter` should be safe, but a full disk, a truncated sync, or a manual edit is not — permanently hides the user's projects.
- **Fix:** on parse failure, move the file aside (`workspaces.json.corrupt-<timestamp>`), then scan `workspace.workspacesRoot` for directories and re-register each as a workspace before persisting; never overwrite a file that failed to parse.
- **Confirm:** write `workspaces.json` with garbage bytes on a device, restart, and check `workspace.list`.

### PD-02 · `window.prompt` / `window.confirm` are no-ops in the Android WebView — CONFIRMED (logic), device impact SUSPECTED
`MainActivity`'s `WebChromeClient` overrides only `onConsoleMessage`. Android WebView cancels unhandled JS dialogs, so on a phone `window.prompt()` returns `null` and `window.confirm()` returns `false` immediately. Phase D routes real features through them:
- **Create / rename workspace** (`WorkspaceSwitcher`) — prompt is `null`, nothing happens, no error.
- **Goto line** (`AppHeader` overflow menu) — silently dead.
- **Delete workspace confirm, Restore-from-backup confirm, Save As "Replace it?", every "Discard unsaved changes?" prompt** — always cancelled.

Some of this predates Phase D (tab close, delete entry), but Phase D's marquee flows (workspace management, backup restore) are newly unreachable on device.
- **Fix:** implement `onJsPrompt`/`onJsConfirm` in the `WebChromeClient` (bridge them to a native dialog or queue a reply), or replace `window.prompt`/`window.confirm` in the web layer with the existing `PromptDialog` sheet — which already exists and is what the plan describes.
- **Confirm on D1/D2:** open the switcher, tap "New workspace…", and check whether a prompt appears.

---

## 3. Themes that explain many findings

1. **Failures leave partial state with no undo.** Import caps throw mid-copy (PD-06), a failed restore copy leaks its temp zip (PD-07), export aborts on the first out-of-root symlink (PD-08), and deleted workspaces keep their drafts forever (PD-09). Each flow needs a "what is on disk if step 3 fails?" answer.
2. **Web state that outlives its context.** Search results, find/replace state and the persisted session all survive a workspace switch they no longer belong to (PD-11, PD-14); a stale search reply can also clobber a newer one (PD-04).
3. **Host/web contract drift, again.** The mock's glob, ignore list, truncated flag, draft sizes and mkdir semantics differ from the host (PD-16), and `SafRestoreRequest.confirm` is accepted and ignored (PD-18). The generated-types drift test only catches renames, not semantics.
4. **Uncoalesced event floods.** `search.match` and `saf.progress` bypass the `EventSink` coalescer that exists precisely for this (PD-05), and the 5 s external-change poll re-hashes every open file through `fs.stat` (PD-12).

---

## 4. Full register

Severity: **H** high, **M** medium, **L** low. "Conf." is C for confirmed by reading, S for suspected (needs a device). Files are relative to `leocode/`.

### 4.1 Workspace registry and drafts — `workspace/WorkspaceStore.kt`, `workspace/Drafts.kt`, `bridge/WorkspaceHandler.kt`, `bridge/DraftHandler.kt`

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| PD-01 | H | C | Corrupt index silently resets the registry and is overwritten (see §2) | Quarantine + re-register directories |
| PD-09 | M | C | `Drafts.deleteWorkspace()` is dead code: `workspace.delete` never purges `filesDir/drafts/<id>/`; the mock does purge (`drafts.delete(id)`), so web and device disagree | Call it in the delete flow |
| PD-20 | L | C | `ensure()` does registry IO on the main thread in `LeoApp.onCreate`; any failure (disk full, unparseable dir) makes every launch land in `RecoveryActivity` with a generic message; `persist()` throwing inside `create()`/`open()` can leave an orphan directory with no record | Move `ensure` to a background thread and sweep orphan dirs in `ensure()` |
| PD-23 | L | C | `DraftInfo.size` is char length on the host but byte length in the mock (`byteLength(draft.content)`), so draft sizes differ between dev and device | Match one convention (chars) in the mock |

### 4.2 SAF import / export / restore — `MainActivity.kt`, `bridge/SafHandler.kt`, `workspace/ZipBackup.kt`, `bridge/SafPort.kt`

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| PD-06 | M | C | `saf.importTree` failure (file/byte cap hit, provider error mid-tree) leaves a partially imported tree with no rollback; the caps throw after writing the offending file; depth > 64 silently truncates the tree; `IOException` maps to the misleading "the document could not be read or written" | Copy into a temp dir under `workspace.tmp` and move into place on success; report the real reason |
| PD-07 | M | C | Temp archives leak: the `restore-*.zip` SAF copy failure path never deletes the partial file (up to 512 MB in `cacheDir`); a `backup-*.zip` scratch survives a process death or Activity destroy while the picker is open; nothing sweeps `workspace.tmp`/`cacheDir` at startup | Delete the partial target on failure; sweep stale `restore-*.zip`/`backup-*.zip` in `LeoApp.onCreate` |
| PD-08 | M | C | `ZipBackup.export` aborts the whole backup on one symlink resolving outside the root (`E_IO`, "cannot create the backup") and follows in-root symlinks; no total-size cap and `node_modules`/`build` are included, so a big workspace can produce a multi-GB zip in app-private cache | Skip out-of-root symlinks (record them in the reply), add export caps, exclude the generated dirs the search ignore-list already names |
| PD-19 | L | C | No concurrency guard: export + restore + import can run simultaneously against the same workspace, and a restore during an export bakes a half-restored tree into the backup; restore also invalidates open buffers (web notices via `checkExternal`, which is fine for data, not UX) | One per-workspace op-lock that answers `E_BUSY` |
| PD-22 | L | C | Restore writes its `.name.<uuid>.tmp` files into the workspace tree itself; a kill mid-restore leaves them visible in the explorer | Stage temps under `workspace.tmp` and `Files.move`, or hide them in `fs.list` |
| PD-21 | L | C | During the SAF copy-out, `exportLauncher` reports `progress(0, copied)` — files always 0, so the settings dialog shows "export: 0 files (N KB)" while bytes tick | Pass the archived file count or drop `files` from this phase |
| PD-18 | L | C | `SafRestoreRequest.confirm` is decoded and ignored by `SafHandler.restoreArchive`; the web sends `confirm: true` and relies on its own (device-broken, PD-02) `window.confirm` | Host checks `confirm == true` or drop the field from the contract |

### 4.3 Search — `workspace/SearchEngine.kt`, `bridge/SearchHandler.kt`, `features/search/searchStore.ts`, `components/SearchPanel.tsx`

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| PD-05 | M | C/S | `search.match` and `saf.progress` events bypass `EventSink` coalescing (`WebViewStreamSink.event` flushes then posts one WebView message each): one message per match (up to 2 000) and per imported file (up to 20 000); on-device jank SUSPECTED | Coalesce events like text/bytes, or batch matches and throttle progress to ~100 ms |
| PD-04 | M | C | Stale search clobbers a newer one: `searchStore.search` awaits the bridge promise without re-checking its own `searchId`; cancel-then-search lets the old reply's `set({ running:false, count, searchId:null })` land while the new search streams, and the old request's still-registered stream keeps appending matches to the new results | Capture `id`; after every await ignore state changes when `get().searchId !== id`, and ignore matches from a superseded request |
| PD-10 | M | C | `SearchEngine` lowercases with the default locale: on `tr`/`az` devices "FILE" no longer matches "file" ("I" → "ı"), and `col` is computed on the lowercased line, which can shift when a case mapping changes length (U+0130 → 2 chars); the glob is always case-insensitive with no opt-out | Use `Locale.ROOT`/case-fold, compute `col` on the original line |
| PD-13 | M | C | The 60 s `fs.search` timeout abandons the client but not the walk: `AndroidBridge.cancelLateRequest` handles `proc.run`/`term.open`/`runtime.install` but not `fs.search`, so a timed-out search keeps scanning and streaming (events dropped) until the host finishes | Send `fs.search.cancel` with `payload.searchId` from the late-reply path and on `E_TIMEOUT` |
| PD-14 | M | C | Switching workspace leaves search results and find/replace state from the old workspace; `jump()` then opens a path that resolves under the *new* root — silently opening the wrong file when names collide | Clear `search` and `findReplace` in `workspaceStore.open` alongside `editor.clearWorkspace()` |
| PD-15 | L | C | Cap edge cases: `maxResults: 0` is coerced to 1 match; `truncated` is `true` when the match count equals the cap even if nothing was cut, and `false` after a cancel (the mock reports the opposite, PD-16); the web never passes `maxResults`, so the 2 000 option is unused | Report `truncated` only when a match beyond the cap was actually dropped; align the mock; treat `0` as the default |
| PD-17 | L | C | `jump()` dispatches `gotoPosition` after a fixed 30 ms timeout: on a slow mount the pane is not ready and the jump is lost silently; jumping into a >1 MB read-only doc lands inside the truncated chunk (or beyond it, where it does nothing) | Have the pane confirm readiness (or retry), and say when the target line is outside the loaded chunk |
| PD-16 | L | C | Mock divergences: name-only globs are tested against the full path (mock misses subdirectory matches the host finds), the ignore list omits `build`/`dist`/`venv`/`.gradle`/`.idea`/`.hg`/`.svn`/trash dirs, cancel sets `truncated = true` (host: `false`), `fs.read` has no 4 MB cap, and `mkdir` on an existing directory throws `E_EXISTS` where the host returns ok | Port the host's glob path/basename rule, ignore list and edge semantics into `mock.ts` |

### 4.4 Editor — `features/editor/editorStore.ts`, `model.ts`, `EditorView.tsx`, `components/EditorPane.tsx`, `Shell.tsx`

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| PD-03 | M | C | Save As on a large-file document writes only the loaded first chunk: `saveAs` has no `readOnly`/`large` guard (the menu enables it for any active doc), so a 5 MB file saved as a copy produces a 1 MB file — silent truncation, no warning. The SAF export path is guarded only by `isDirty`, which a read-only doc never is | Guard `saveAs`/`saveSaf` like `save` does, or load the full file before Save As |
| PD-11 | M | C | Session restore silently dies after the first workspace switch: `clearWorkspace()` empties the docs, the debounced `persistSession` then wipes `leocode.open-session`, and nothing repopulates it until the user reopens tabs by hand | Store the workspace id in the session and skip the persist triggered by `clearWorkspace` |
| PD-12 | M | S | The 5 s `checkExternal` poll runs `fs.stat` on every open non-untitled doc, and `fs.stat` hashes the whole file each time (W-25 amplified): N tabs × 12 hashes/minute on large files = battery and heat | Compare size+mtime first and hash only when they differ, or back off the interval |
| PD-24 | L | C | `renamePath` moves a draft with an unsequenced `readDraft → saveDraft(to) → deleteDraft(from)`: a draft autosave landing in between is deleted with the old path while the new path keeps stale content | Sequence under a per-path lock or carry the draft in the same request |

### 4.5 Transport and shell — `bridge/android.ts`, `bridge/timeouts.ts`, `features/shell/Shell.tsx`, `features/layout/AppDialogs.tsx`

| ID | Sev | Conf. | Problem | Fix in one line |
|---|---|---|---|---|
| PD-02 | H | C/S | JS dialogs are no-ops in the unpatched WebView (see §2) | Native `onJsPrompt`/`onJsConfirm` or the `PromptDialog` sheet |
| PD-25 | L | C | An import/export/restore in flight cannot be cancelled from the UI (no host cancel for `saf.*` heavy work), and closing the Settings sheet while one runs only hides the status, giving no hint that the operation continues | Show a persistent progress row outside the sheet, and add cancellation where the host can provide it (import/restore) |

---

## 5. What was checked and is sound

Worth stating so the fixes do not regress them:

- **Restore safety:** `safeEntryName` + `ensureUnder` (canonical, after `..`/drive/NUL rejection) defeat zip slip twice; per-entry 64 MB, total 512 MB and 20 000-file caps hold; every regular file goes through a unique temp + `Files.move(REPLACE_EXISTING)`; `ZipBackup.IGNORED_DIRECTORIES` (`.trash`/`.leocode-trash` only) matches export, so a round trip loses nothing.
- **Editor concurrency:** every in-workspace save goes through `expectedHash`; a missing file with a baseline is `E_CONFLICT`; `Keep mine` on a vanished file saves with `expectedHash: null` and recreates it — the data-loss corner (deleted file + dirty buffer) resolves without overwriting anything.
- **Draft hygiene:** drafts live outside the workspace tree, keyed by workspace + SHA-256 of the path, capped at 4 MB, skipped for untitled/SAF/read-only docs, and the 3 s timer is cleared on close, close-all, clear-workspace and dispose.
- **Workspace delete:** goes through the trash, refuses `default`, falls back to default when the active one goes, and `fs.rename`/`fs.delete` protect every workspace directory and both trash dirs (`protectedRoots`), so the tree cannot be destroyed from the file side.
- **Bridge replies:** one reply per request via `AtomicBoolean`; every callback (SAF worker threads included) funnels through `BridgeHost.post` → main-thread `proxy.postMessage` with a catch, so a late reply after a renderer rebuild is dropped, not crashed.

---

## 6. Device checks (D1/D2, all SUSPECTED until run)

| Check | Exercises | Expect today |
|---|---|---|
| Switcher → "New workspace…", "Rename current…" | PD-02 | No prompt appears on device; nothing happens |
| Switcher → "Delete current…" | PD-02, PD-09 | Confirm auto-cancels; workspace is never deleted |
| Settings → "Restore from backup…" with a 300 MB zip | PD-07, PD-02, PD-05 | Confirm auto-cancels; even if it passes, verify `cacheDir` is clean after a forced cancel mid-copy |
| Settings → "Import folder…" with a folder containing > 20 000 small files | PD-05, PD-06 | UI jank/stutter from per-file events; partial tree left behind when the cap fires |
| Settings → "Export workspace backup…" in a workspace with a symlink out of the root | PD-08 | Export fails with "cannot create the backup" |
| Open a 3 MB text file, then File → Save As | PD-03 | New file is silently 1 MB |
| Turkish (`tr`) system language, search for "FILE" in a file containing "FILE" | PD-10 | No matches |
| Run a search, tap Search again mid-run | PD-04 | "Searching…" indicator disappears while matches keep arriving; Cancel greyed out |
| Delete a workspace, check `filesDir/drafts/<id>/` afterwards | PD-09 | Drafts still on disk |
| 8 open tabs incl. a 2 MB file, leave the editor open 1 min | PD-12 | Noticeable battery/CPU; `logcat` shows repeated SHA-256 work |
| Kill the app during a workspace rename, then corrupt `workspaces.json` externally and relaunch | PD-01, PD-20 | Other workspaces vanish from the switcher |

---

## 7. Suggested fix batches

1. **Batch 1 — data integrity (PD-01, PD-03, PD-06, PD-07, PD-09, PD-22):** registry quarantine, Save As guard, import/restore temp-and-move, archive sweeps, draft purge. All JVM/web-testable.
2. **Batch 2 — search correctness (PD-04, PD-10, PD-13, PD-14, PD-15, PD-16, PD-17):** locale-safe matching, stale-reply guard, late-search cancel, workspace-switch clears, cap/truncated semantics, mock parity.
3. **Batch 3 — device reachability (PD-02, PD-05, PD-12, PD-08, PD-18, PD-19, PD-20, PD-21, PD-23, PD-24, PD-25):** JS-dialog bridge or prompt sheet, event coalescing, stat-hash throttle, export caps/symlinks, op-lock, `confirm` check, background `ensure`.

Each ID needs a failing test first, per the house rule in [`phase-b-c-analysis.md`](phase-b-c-analysis.md) §8. Device-tagged items stay open until the D1/D2 pass recorded in [`../test-matrix.md`](../test-matrix.md).
