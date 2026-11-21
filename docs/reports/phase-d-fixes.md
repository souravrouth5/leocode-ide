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
4. **Device pass.** The D2 pass on 2026-11-15 covered PD-02, PD-05, PD-06, PD-07, PD-11, PD-12,
   PD-14, PD-17, PD-21, PD-22, PD-25, PD-01/PD-20 and the delete-active-workspace fallback; see
   [Device verification (D2)](#device-verification-d2). D1 stayed disconnected. PD-19 and PD-25
   cancellation are not reachable through the UI, and the 20 000-file import cap-hit rollback is
   unit-tested only. The SAF Activity wiring is compile- and lint-verified only (no Robolectric).

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

## Device verification (D2)

Verification ran on 2026-11-15 against a debug APK built from `v9-impl`, containing the Phase D
fixes plus `5d6c6fa` (the fallback-session fix). Device: POCO F1 (`beryllium`), Android 15 /
API 35, 1080×2246 @ 440 dpi, serial `192.168.29.3:42077`. D1 (Redmi Note 7S) was disconnected for
the whole pass, so every result below is D2-only. Screenshots are stored in `docs/device-reports/`
with names starting `20261115-`; references below give only the trailing numbers.

- **PD-02 — in-app dialogs (High). PASS.** Overflow/workspace menu → **New workspace…** opened the
  in-app prompt with the keyboard up; a native `window.prompt` is dead in this WebView, so the
  prompt rendering and taking input is itself the check. Created `pd02check`, **Rename current…**
  renamed it to `pd02renamed`, and **Delete current…** showed the in-app confirm sheet. System
  Back dismissed the confirm without deleting (workspace list unchanged); confirming Delete moved
  the workspace to the trash and fell back to Default. Screenshots 02–18.
- **PD-01 / PD-20 — registry recovery and orphan adoption (High). PASS.** With the app stopped,
  `files/workspaces.json` was replaced by invalid JSON and an extra directory
  `files/workspaces/adopted1/note.txt` was created. On launch the corrupt file was preserved
  verbatim as `files/workspaces.json.corrupt-1794721718229`, a fresh registry was written with
  Default kept under its friendly name, and `adopted1` was re-registered from disk. Opening
  `adopted1` from the switcher showed `note.txt`. Screenshots 19–25.
- **PD-11 — per-workspace sessions. PASS.** Switching away from Default cleared its tabs;
  switching back restored `perm.sh`, `big.txt` and `medium.txt` with `medium.txt` active. The
  stored session survived force-stop plus relaunch. Screenshots 26–29, 56, 67–68.
- **PD-11 tail — fallback session (`5d6c6fa`). PASS.** Deleting the workspace that is currently
  active used to clear the editor but never restore the fallback root's session, so Default's tabs
  stayed hidden until a restart. With the fix, deleting the freshly created `pd11fix` while it was
  active brought Default's three tabs back immediately. Screenshots 77–78.
- **PD-03 — large-file guard. PASS.** Opening the 2.3 MB `big.txt` showed **Large file mode /
  Showing the first 1.0 MB of this file. Editing is disabled.**, and Save As warned **Only the
  first 1 MB is loaded, so Save As would write a truncated copy.** Screenshots 39–41.
- **PD-17 — workspace search → jump. PASS.** Header overflow → **Search in Workspace**. Searching
  `echo` returned `perm.sh:1`; tapping it activated the tab with the caret on line 1. A second
  check used a generated `medium.txt` (187 KB, 4000 lines) with `MARKER_PD17_SENTINEL` on line
  4000: the result row showed `medium.txt:4000`, and tapping it scrolled the editor to line 4000,
  highlighted that line and put the caret there, with no "Could not jump" or "pane unavailable"
  notification. Screenshots 49–61.
- **PD-14 — search state reset on switch. PASS.** With a completed search and one result on
  screen, switching workspaces cleared the result list and count while keeping the typed query;
  the new root's editor had no tabs. Screenshots 62–63.
- **PD-12 — poll cost. PASS.** Three tabs open including the 2.3 MB `big.txt`, idle for 60 s:
  33 CPU ticks = 0.33 s, about 0.55 % of one core, and `dumpsys gfxinfo` reported 0 frames
  rendered in that window. Control run with a single 20-byte tab: 23 ticks. `/proc/<pid>/io` is
  not readable from adb shell on this build, so the measurement is CPU- and frame-based. No sign
  of the previous whole-file re-hash cadence.

### Further device checks (D2, continued)

Same device, APK build and serial as above; these ran after the checks listed above.

- **PD-25 — persistent progress banner. PASS.** Started a 1 500-file folder import from
  `/sdcard/Download/pd05big`, then immediately closed the Settings sheet. The banner stayed
  visible outside Settings and read **Importing a folder — import: 230 files… — Continues if
  Settings is closed**. Screenshot `20261115-101-banner-live.png` (also 98–100). The earlier
  blind-tap attempts missed the ALLOW button because the native dialog height varies;
  `uiautomator` bounds were used to tap it reliably.
- **PD-21 — real progress counts. PASS.** After a successful export the Environment tab reported
  **Backed up 44 files (23349.6 KB)**; the export archive was 21 231 174 bytes in
  `/sdcard/Download/leocode-backup.zip`, and the app cache had no `backup-*.zip` left (scratch
  deleted on success). Banner progress during import showed file counts (e.g. 230 files), not a
  stuck 0. Screenshots 83–90.
- **PD-05 — import frame cost. PASS.** Importing 1 500 files (500 per directory × 3, ~3.85 MB tar
  payload) with `dumpsys gfxinfo` reset immediately before the ALLOW tap: 399 frames rendered,
  14 janky (3.51 %), p50 15 ms, p90 19 ms, p95 20 ms, p99 32 ms. Idle control on the same screen:
  0 frames rendered. No ANR, no visible stall. Screenshots 94–99.
- **PD-06 — no-overwrite and rollback. PASS.** Before importing, `pd05big/keep.txt` and the
  colliding `pd05big/dir0/f0000.txt` were seeded with `LOCAL-KEEP do not overwrite`. Three
  consecutive imports of the same 1 500-file folder created `pd05big-2`, `pd05big-3` and
  `pd05big-4` (1 500 files each) instead of merging. Both sentinels in the original `pd05big`
  still read `LOCAL-KEEP do not overwrite`. No staging directory was left behind and no partial
  documents appeared. (The 20 000-file cap-hit rollback path was not exercised on device; it is
  covered by unit tests only.)
- **PD-07 — kill during archive copy. PASS with a note.** A 21.2 MB export was restored into a
  fresh empty workspace `restoretest` (id `209e19e0`) and the app was force-stopped as soon as the
  restore scratch archive appeared in `cache/` (device-side watcher, killed after 260 polls). After
  the kill: `cache/restore-1794732714957.zip` was 20 316 160 of 21 231 174 bytes, the workspace
  directory was still empty, and there was no `files/workspace.tmp`. On relaunch the archive
  survived, by design: `ScratchSweeper` only deletes `restore-*` older than a 1-hour TTL. Ageing it
  with `touch -t 202601010000` and restarting swept it ("swept 1 stale scratch entr(ies)").
- **PD-22 — kill during extraction. PASS; a sweep gap it exposed was fixed.** The restore was
  repeated and the app force-stopped after the first files had been moved into place (on-device
  watcher polling the workspace file count, killed at 3 files; 8 files had landed by the time the
  process died). Eight files were present — `big.txt`, `medium.txt`, `perm.sh` and
  `restorebulk/blob00.bin` … `blob04.bin` — and all eight were byte-identical to the archive
  entries: md5 matched for every file when compared with `unzip -p`. No `.tmp` file existed
  anywhere under `files/workspaces/209e19e0`, and no `files/workspace.tmp` existed; the in-flight
  temp was `files/tmp/.blob05.bin.<uuid>.tmp` (474 991 bytes), under the scratch root and outside
  the workspace tree, which is the PD-22 fix. The partial archive `cache/restore-<id>.zip` was the
  full 21 231 174 bytes because the copy completes before extraction starts.

  That kill also showed the per-entry temp name (`.name.<uuid>.tmp`) matched no `ScratchSweeper`
  prefix, so it would have leaked forever. Fixed in this batch:
  `ScratchSweeper.defaultRules(cacheDir, scratchDir)` now owns the startup rules and sweeps
  hidden restore temps (prefix `.`) in the workspace scratch directory, in addition to
  `restore-*` in `cache/` and `backup-*` / `import-*` in scratch. A failing unit test was written
  first (`ScratchSweeperTest.default rules sweep a killed restore archive and its hidden temp`) and
  now passes; it also asserts a young temp and an unrelated file are kept. On device the leftover
  temp and archive were aged with `touch -t 202601010000`, a rebuilt APK was installed over the old
  one, and the next launch logged `swept 2 stale scratch entr(ies)` with both entries gone. No temp
  files remained in `cache/` or `files/tmp/`.

**Still not covered.**

- PD-19 (concurrent SAF operations) and PD-25 cancellation are not reproducible through the UI
  alone: there is no host cancel API, and the picker serialises operations.
- PD-06 cap-hit rollback (20 000 files / 512 MB) was not exercised on device; unit tests cover it.
- D1 (Redmi Note 7S) stayed disconnected, so no D1 results exist.
