# Web layer after Tasks 11-13: bridge client, error UX, feature stores

Review of `web/src` at `4389983` (branch `v9-impl`, diff `542e14e..HEAD`). The three tasks replace the old `App.tsx` with a hardened bridge client (timeouts, abort, retry), a catalog-driven error UX, and Zustand stores per feature. The structure is sound: stores are built once through manual DI, the catalog covers all 24 generated codes, and the late-reply handling in `send()` is correct. The problems are at the seams: the timeout table disagrees with what the host does for `runtime.install`, several store actions can destroy user text, and some Task 11/12 claims in `PROGRESS.md` are not backed by code.

Watch for: (1) `runtime.install` is timed out at 10 s on the web while the host replies only at the end of the install, so any real install fails with `E_TIMEOUT` (confirmed). (2) `save()` marks text typed during the write as saved, and "New file" / "Save As" overwrite existing files without asking (confirmed). (3) `E_BRIDGE_DISCONNECTED` can never fire in production and Copy details performs no redaction, although both are claimed as done (confirmed).

**Verdict**: NEEDS_CHANGES

## High-level view

The bridge client's request/settle logic is solid: one pending slot per id, timer and abort listener removed on every exit path, late replies dropped. The weak points are policy, not mechanics. The timeout table treats `runtime.install` as "reply on start" but the Kotlin handler replies once when the install finishes. Timing out or aborting `proc.run` / `term.open` leaves the host job running. Disconnect handling clears stream handlers silently, and nothing in the app ever dispatches the event that triggers it.

The error UX routes every code to a surface, but the surface content is not safe or complete. Copy details, banners and snackbars show raw host messages with no redaction, although plan 7.5 requires it. The `E_CONFLICT` banner's "Reload" reloads the whole page, which discards dirty buffers. Conflict detection itself does not exist, so that banner is unreachable. The snackbar store cannot hold a notice open (`null` duration is coerced to 4.5 s), and the Android back button ignores the error sheet and banner.

The stores are a clean split, but several actions have data-loss or stale-state races: the save/dirty race, duplicate tabs on double open, directory rename leaving stale tab paths, delete leaving no active tab, CRLF files silently converted to LF, a file-list response race, and a cached "Python missing" probe that survives installing Python. Run output from a closed run can leak into the next run. The terminal has no real flow control (ack is sent before xterm renders) and does not resize after reattach.

Most of the tests run against `MockBridge`, which throws plain `Error` and overwrites on rename, so the real error codes and the host's conflict semantics are never exercised.

<details>
<summary>Issues (38)</summary>

1. **W-01 runtime.install times out at 10 s** — host replies at completion; give `runtime.install` `timeoutMs: null` (or make the host reply on start) and fix the contract and test that assert 10 s.
2. **W-02 Save clears dirty for unsaved text** — `save()` sets `saved: item.content` after the await; set it to the content that was written.
3. **W-03 New file truncates an existing file** — `bridge.write(path, "")` has no create-only semantics; check existence or add a create-new flag.
4. **W-04 Save As overwrites silently** — add an existence check or confirmation before `bridge.write(target)`.
5. **W-05 Conflict banner reloads the page** — `reload` action maps to `location.reload()`; for `E_CONFLICT` reload the file via `editor.reload()`.
6. **W-06 No external-change detection** — `E_CONFLICT` is never raised; save blindly overwrites. Either add mtime/etag to `fs.read`/`fs.write` or drop the claim.
7. **W-07 Disconnect is dead code and silent for streams** — nothing dispatches `leocode:bridge-disconnected`; `disconnect()` also drops stream handlers without notifying runs or terminals.
8. **W-08 Timeout/abort leaves host work running** — send `proc.cancel` / `term.close` when `proc.run` or `term.open` fails after posting.
9. **W-09 No redaction in Copy details, banners, snackbars** — implement the 7.5 web redactor and apply it to all user-visible message text; add real tests.
10. **W-10 Snackbar `null` duration impossible; queue unbounded** — `?? 4_500` turns `null` into 4.5 s; cap and de-duplicate the queue.
11. **W-11 Global handler can raise a blocking sheet for benign errors** — filter `ResizeObserver loop` and add a re-entrancy / rate guard.
12. **W-12 Back button ignores error sheet/banner and kills a running job** — extend `__leocodeBack`; hiding the Run sheet should not cancel the process.
13. **W-13 "Python missing" cached forever** — reset `pythonReady` after a runtime install or on each Run when it was false.
14. **W-14 Old run bleeds into the next run** — tag events and `finish()` with a run id.
15. **W-15 File list race and premature cwd** — add a request token in `refresh`; set `cwd` only after a successful list.
16. **W-16 Duplicate tabs on double open** — re-check `docs` after the await in `openFile`.
17. **W-17 Directory rename/delete leave stale tabs** — `renamePath` handles only exact paths; delete sets `activePath` to null while tabs remain and discards dirty buffers silently.
18. **W-18 CRLF files converted to LF on first save** — remember each document's line ending and restore it on write.
19. **W-19 saf:// documents cannot be saved correctly** — `save()` sends `saf://name` to `fs.write`; use `saf.save` or disable Save.
20. **W-20 Terminal has no backpressure** — ack after xterm's write callback, not on receipt.
21. **W-21 No PTY resize after attach** — send current cols/rows once attach succeeds.
22. **W-22 Failed attach spawns a second PTY** — only fall back to `openTerminal` on `E_NOT_FOUND`; report other errors.
23. **W-23 Fire-and-forget calls swallow errors** — report (rate-limited) failures of `term.write`, `term.ack`, `term.resize`, `proc.cancel`, `runtime.cancel`, `setTheme`, `getTheme`.
24. **W-24 Editor remounts on every tab switch** — undo history, scroll and selection are lost; keep one `EditorState` per document.
25. **W-25 Per-keystroke O(file size) work and unvirtualised file list** — avoid `doc.toString()` per keystroke, memoise dirty state, hoist `Intl.Collator`, cap or virtualise rows.
26. **W-26 Session restore loses unsaved text and can overwrite newer tabs** — persist dirty buffers (or warn), merge instead of replace, and keep paths that failed for transient reasons.
27. **W-27 Storage permission flow unreachable** — nothing calls `requestStoragePermission`; shared-storage bookmarks end in a dismiss-only sheet.
28. **W-28 No file-name validation; prompt closes on failure** — validate slashes, `.`/`..`, length, reserved names; keep the prompt open and show `E_EXISTS` inline.
29. **W-29 Only editor/terminal/runtimes have error boundaries** — Files, drawer, header and dialogs crash the whole app into `CrashScreen`.
30. **W-30 Theme has three sources of truth** — `Shell` pushes `settings.appTheme` into the host and can override the host's stored theme at boot.
31. **W-31 Format-on-save only on Ctrl+S** — menu/button Save skips formatting.
32. **W-32 File rows activate on `pointerup` only** — keyboard Enter and some assistive taps do nothing.
33. **W-33 Closed sheets stay in the DOM as modal dialogs** — add `inert`/`visibility:hidden`, focus trap and focus restore.
34. **W-34 Settings load has no validation; some settings are dead** — wrong-typed stored values can crash render; `sortBy`/`showHiddenFiles`/`filterBinaryFiles`/`openTabs`/`activeTab` are unused.
35. **W-35 `lazyWithRetry` flag never cleared** — only one stale-chunk recovery per tab session.
36. **W-36 MockBridge does not match the contract** — throws plain `Error`, overwrites on rename, no `E_BINARY`/`E_LIMIT`; tests give false confidence.
37. **W-37 Stream-event handler exceptions are uncaught** — wrap event dispatch in `receive()`; invalid base64 or a missing payload throws inside `onmessage`.
38. **W-38 Run sheet gaps** — no stdin, failures bypass the catalog, per-frame DOM growth with alternating streams.

</details>

<details>
<summary>Details</summary>

## Bridge client: timeouts, streams, disconnect

**W-01 (High) runtime.install is killed after 10 s.** `bridge/timeouts.ts:34-38` gives every method outside the user-wait list and `fs.write`/`workspace.*` the 10 s fast timeout, and `timeouts.test.ts` asserts `runtime.install` is 10 s "reply-on-start". The contract (`bridge-contract.md` line 62, 157) says the install replies on start. The host does not: `android/.../bridge/RuntimeHandler.kt` runs the install on an executor and calls `respond(AsyncReply.Ok(...))` once the installer finishes ("An install streams `runtime.progress` and replies once when it finishes"). Scenario: user taps Install Python (22 MB) in `RuntimeManager`. `AndroidBridge.installRuntime` posts `runtime.install` at `android.ts:435`, the timer fires at 10 s and rejects with `E_TIMEOUT`, `streams.delete` runs, so progress events stop. `startInstall` shows "…Retry when the device is idle." The host install continues. Retry gets `E_BUSY` until it finishes, then the late reply is ignored. Fix: pass `timeoutMs: null` for `runtime.install` (cancel stays via `runtime.cancel`) or change the host to reply on start and emit a `done` progress event; update the contract and the test. Confidence: CONFIRMED BY READING (web `timeouts.ts` plus `RuntimeHandler.kt`). A device install on D1 would confirm it.

**W-07 (Medium) Disconnect handling is unreachable and silent.** `android.ts:69` listens for `leocode:bridge-disconnected`, but nothing in `web/src` or in the Kotlin sources dispatches it (`MainActivity.onRenderProcessGone` recreates the whole WebView instead). Task 11 claims "disconnect + event → `E_BRIDGE_DISCONNECTED`". Even if it fired, `disconnect()` (`android.ts:73-86`) clears `streams` without telling anyone: a `proc.run` promise whose reply already arrived waits on `exit` forever (the Run sheet shows "running" until closed), and a terminal stays in "pty" state with no exit callback, while keystrokes go nowhere. After disconnect the bridge keeps sending (no "disconnected" state), so the next call times out at 10 s instead of failing fast. Fix: add a host-side or heartbeat trigger (for example a periodic `app.info` with 2 s timeout while any stream is open), make `disconnect()` resolve run exits with an error and call terminal `onExit(-1)`, and set a flag so later calls reject at once. Confidence: CONFIRMED BY READING.

**W-08 (Medium) Timeout or abort does not stop the host work.** In `send()` a timeout or abort only rejects the web promise. `proc.run` aborted or timed out (`android.ts:256-285`) leaves the process running with no `proc.cancel`; `term.open` timing out leaves an orphan PTY (the late reply's `sessionId` is dropped, and the saved id is never written). Streamed methods are never retried, so this is not a double-execute, but the leak is invisible. Fix: on `proc.run`/`term.open`/`runtime.install` failure after the request was posted, remember the id and issue the matching cancel/close when the late reply arrives. Confidence: CONFIRMED BY READING for the web side; host behaviour on a never-consumed job is SUSPECTED.

**W-23 (Medium) Fire-and-forget calls swallow errors.** `android.ts:289, 321, 364, 446` and `ThemeProvider.tsx:85, 102` use `.catch(() => {})`, with comments that justify it. For `term.write` a `E_TIMEOUT` or `E_NOT_FOUND` means typed input is lost and nothing is shown, which is the "nothing fails silently" case. `TerminalChannel.write()` (`android.ts:570`) also drops input silently while `sessionId` is empty (typing during the `term.open` round trip), so the `queued`/`setSession` flush path at lines 521-526 is never exercised. The Task 12 claim "every silent `catch {}` replaced" is not true (see claims section). Fix: route repeated failures to the error store once per burst (for example "Terminal input is not reaching the shell"). Confidence: CONFIRMED BY READING.

**W-37 (Low) Stream handler exceptions escape.** `receive()` (`android.ts:192-221`) calls stream handlers unguarded. `base64ToBytes` (`atob`) throws on invalid base64, and `payload.data`/`payload.b64` are read without checks. The exception surfaces as a window `error`, which the global handler turns into a sheet. Fix: try/catch around the handler call, dropping or reporting once. Confidence: CONFIRMED BY READING that no guard exists; whether the host can send bad payloads is SUSPECTED. Also: ids restart at 1 on each `AndroidBridge` instance (`seq`), so after a page reload a reply for an in-flight request of the old page could collide with a new id. Whether the host's reply proxy is per-page is not verified here (SUSPECTED, low).

The boot handshake `info({timeoutMs: 2000})` is an idempotent read and is retried once, so a dead host delays boot by 4 s, not the 2 s the comment implies (Low).

## Error surfaces: content, routing, handlers

**W-09 (Medium) No redaction.** Plan 7.4/7.5 require that Copy details exclude paths outside roots, tokens and URL credentials, and contain correlation id, method, app/Android/WebView version. `catalog.ts:234-245` (`errorDetails`) prints `error.message` verbatim; its doc comment says "No paths, tokens or stacks" but no code enforces that. The same raw `error.message` is rendered in `ErrorSheet.tsx:31`, `InlineBanner` (via `ErrorSurfaces`), snackbar `detail` (`errorsStore.ts:306`), `PaneError`/`CrashScreen` copy text, and the Run sheet. Host messages can contain paths (`E_IO "cannot write /storage/..."`), and JS `Error.message` can contain anything. Scenario: a git/auth failure in a later task puts `https://user:token@host/...` in the message and "Copy details" puts it on the clipboard. The test `catalog.test.ts:36` ("builds redacted details") only checks that the string contains `E_IO` and not `"at "`, so it asserts nothing about redaction. Fix: implement the web redactor (tokens, `Authorization`, URL user-info, paths outside workspace/shared-storage roots → `<outside>`), apply to every message sink, add the plan's fields, and test with hostile inputs. Confidence: CONFIRMED BY READING.

**W-05 (Medium) Conflict banner's Reload reloads the page.** `E_CONFLICT` has `action: reload` (`catalog.ts:134-141`) and `ErrorSurfaces.tsx:31` and `ErrorSheet.tsx:24` map every `reload` action to `location.reload()`. For a file conflict the user expects "reload this file". Reloading the page drops all dirty buffers (session restore keeps only paths, see W-26). Fix: per-code handler, or let `report()` accept an action override (`editor.reload(path)`). Confidence: CONFIRMED BY READING; practical reach is limited by W-06.

**W-06 (Medium) No conflict detection.** Nothing in the web code produces `E_CONFLICT` (`save()` at `editorStore.ts:122-144` writes unconditionally; `fs.write` has no expected-mtime parameter). The plan 7.3 example "File changed on disk · Reload / Keep mine" does not exist. Scenario: edit `main.py` in LeoCode, change it from the terminal (`sed -i`), press Save: the terminal edit is overwritten without a prompt. Fix: carry `mtime` from `fs.read`/`fs.list` and send it as a precondition. Confidence: CONFIRMED BY READING.

**W-10 (Medium) Snackbar queue.** `notificationsStore.ts:41` computes `durationMs: input.durationMs ?? 4_500`. `null` ("keep until dismissed", documented on the type) becomes 4.5 s, so a persistent or undo notice always expires. The only test that uses `null` renders `Snackbar` with props directly (`surfaces.test.tsx:24`), so it never reaches the store. The queue has no cap and no de-duplication: 20 repeated failures show 20 snackbars one after another, 5 s each (100 s). The timer cleanup in `Snackbar.tsx` is correct (cleared on unmount, keyed by `notice`). Undo is not implemented anywhere (see claims). Fix: use `input.durationMs === undefined ? 4500 : input.durationMs`; collapse identical `message+detail` already queued. Confidence: CONFIRMED BY READING.

**W-11 (Medium) Global handlers.** `globalHandlers.ts:9,12` report every window `error` and `unhandledrejection` through `errors.report`, and `E_INTERNAL` is a blocking sheet. Chromium fires a benign `ResizeObserver loop completed with undelivered notifications` ErrorEvent (no `error` object) when a ResizeObserver callback triggers layout; `TerminalPane` uses a ResizeObserver with fit, so this is plausible on keyboard open/close and would pop "Something went wrong" over the terminal. There is no de-duplication, rate limit, or re-entrancy guard: if `report` itself throws, the throw is a new window `error`, which calls `report` again. Handlers are installed only after the bridge connects (`App.tsx:36-42`, `stores` is null before), so boot-time errors are only logged. Fix: ignore the ResizeObserver message, guard re-entrancy, and report boot errors to `BootError`. Confidence: SUSPECTED for the ResizeObserver case (confirm by opening the terminal and toggling the soft keyboard with `?simulate` off while watching for a sheet); CONFIRMED BY READING for the missing guards.

**W-12 (Medium) Back button.** `Shell.tsx:44-62` handles drawer, run sheet, prompt/settings, and non-editor views. It ignores the error sheet and the banner, so back with an open `ErrorSheet` leaves the activity. Closing the Run sheet through back (or the header X, `RunSheet` → `run.close()`) cancels the running process (`runStore.ts` `close()` calls `handle.cancel()`), and there is no "hide" option. It also ignores the `ActionSheet`s inside `FileTree` and `EditorMenus` (local state). Fix: sheets register themselves in a small stack the back hook pops. Confidence: CONFIRMED BY READING.

**W-29 (Medium) Error boundaries are not per pane.** Boundaries exist in `EditorView` (resets on `path`), `TerminalView` and `RuntimesView`, plus the app-level one in `App.tsx`. `FilesView`, `ExplorerDrawer`/`Sidebar`, `AppHeader`, `AppDialogs` and `ErrorSurfaces` are unprotected. A render error in `FileTree` (for example a non-array `bookmarks` from corrupt settings, W-34) reaches the app boundary and replaces the whole IDE with `CrashScreen`. The plan says a pane crash leaves other panes working. "Reload panel" (`reset`) remounts correctly for the three boundaries that exist. Errors inside the error UI itself have no separate boundary. Confidence: CONFIRMED BY READING.

**W-35 (Low) lazyWithRetry.** `lazyWithRetry.ts:17-18` sets the `sessionStorage` flag and never clears it after a successful load, so a second stale-chunk event in the same session does not retry. It also calls `location.reload()` then throws, so the pane flashes its error fallback before the reload. Confidence: CONFIRMED BY READING.

## File editing, tabs and sessions

**W-02 (High) Dirty state cleared for text that was not written.** `editorStore.ts:130-134`: `await bridge.write(path, doc.content)` writes the content captured before the await, then sets `saved: item.content`, the content at completion. Scenario: press Save on a 1 MB file (write takes 300 ms+ on the Redmi), keep typing; the write completes, `saved` becomes the newer text, the tab shows clean. Close the tab: no discard prompt, the typed text is gone and was never on disk. Fix: `saved: doc.content`. Confidence: CONFIRMED BY READING. `saveAs` (line 172) uses `doc.content` correctly.

**W-03 (High) New file overwrites.** `promptActions.ts:38-39` calls `bridge.write(path, "")`; the host `FsHandler.write` always overwrites (atomic write, no create-only). Scenario: File → New file → "main.py" in a folder that has `main.py`: the file is truncated to 0 bytes, then opened empty. The E_EXISTS the contract describes as an inline field error is never produced. Fix: `list` or `read` first (or add `createNew` to `fs.write`); show `E_EXISTS` inline. Confidence: CONFIRMED BY READING.

**W-04 (High) Save As overwrites.** `editorStore.ts:168` writes to `target` without checking. Scenario: Untitled-1 → Save → name prefilled `Untitled-1.txt`, user types `notes.md` which exists: contents replaced. It also does not check whether `target` is already open in another tab, which creates two tabs with the same path (React duplicate key, writes race). Confidence: CONFIRMED BY READING.

**W-16 (Medium) Duplicate tabs on double open.** `openFile` checks `docs` at line 57, awaits `bridge.read`, then appends at line 64 without re-checking. Two taps on the same row (or a row tap plus the Recent list) before the read returns create two docs with one path. Confidence: CONFIRMED BY READING. Path identity is textual (`a.py` vs `./a.py` vs absolute), so the same file can also open twice through different entry points (SUSPECTED).

**W-17 (Medium) Rename and delete leave stale state.** `renamePath` (`editorStore.ts:309-314`) updates only an exact path match. Renaming a folder keeps tabs under it pointing at the old path; the next Save writes to the old location, and `FsHandler.write` does `mkdirs`, so it silently recreates the old folder. `deleteEntry` (lines 282-307) drops docs under the deleted path with no warning about unsaved edits (the confirm text only names the entry) and sets `activePath` to null even when other tabs remain, so the editor shows "No file open" above a tab strip with tabs. Delete is moved to the host trash, but there is no undo in the UI (plan 7.3 shows "Moved to trash · Undo"; the web shows a "Deleted" flash). Renaming onto the path of an open doc produces duplicate keys (W-16). Confidence: CONFIRMED BY READING. The D1 verification only covered renaming a single file.

**W-18 (Medium) CRLF to LF on save.** `model.ts` `initial()` and `reload()` normalise `\r\n` to `\n` on load; `save()` writes `doc.content`, so the first save of a CRLF file rewrites every line ending. Dirty tracking compares normalised text, so no prompt hints at it. The editor pane also normalises its initial doc. Effect: whole-file diffs in git, and breakage for scripts that need CRLF (batch files). Fix: record `eol` per doc and convert back on write. Confidence: CONFIRMED BY READING.

**W-19 (Medium) SAF documents.** `openSafDocument` creates a doc with path `saf://<name>` and `saved` set, so `save()` takes the normal branch and calls `bridge.write("saf://name", …)` (`editorStore.ts:131`), which goes to `fs.write` and the path jail, not to `saf.save`. `bridge.saveSafDocument` is never called from the web. Save As on a SAF doc writes into the workspace instead. Persisted sessions skip `saf://` docs (correct). Outcome depends on how `PathJail` treats `saf://name` (an error, or a relative file named `saf:/name`): SUSPECTED for the host side; the web routing bug is CONFIRMED BY READING.

**W-26 (Medium) Session restore.** `persistSession` (`editorStore.ts:321-345`) stores only paths and the active tab. Unsaved text lives in memory only, so a renderer kill (low RAM on the 3.8 GB Redmi, plan risk) or an Android process death loses dirty edits. The restore code reads all tabs in parallel (fine) but: (a) `set({ docs: valid })` at line 267 replaces rather than merges, so a tab opened or an Untitled created while restore is in flight is lost; (b) any read failure, including `E_TIMEOUT` or a not-yet-granted storage permission, counts as "missing", and the next `persistSession` rewrites the list without it; (c) corrupt JSON reports an `E_INTERNAL` sheet once, then self-heals. `persistSession` runs on every store change including each keystroke (`store.subscribe`, line 347), so each character does a `JSON.stringify` and a synchronous `localStorage.setItem` (SUSPECTED to be noticeable on slow flash). Also: the `beforeunload` listener and store subscription are never removed (harmless unless stores are rebuilt, for example in tests or HMR). Confidence: CONFIRMED BY READING for (a)(b).

**W-24 (Medium) Tab switch destroys editor state.** `EditorView.tsx:82` gives `EditorPane` `key={activeDoc.path}` and an `initialContent`, so each switch destroys the `EditorView` and builds a new state. Undo history, selection, scroll position and fold state are lost per tab switch, so "Undo" after switching tabs does nothing. Confidence: CONFIRMED BY READING.

**W-25 (Medium) Performance with large inputs.** Every keystroke runs `update.state.doc.toString()` (EditorPane), copies the full text into the store, and then `EditorView` runs `isDirty` for every open doc (two regex replaces over content and saved text each) and `AppHeader` for the active one, so cost grows with file size times tab count. The host allows reads up to 2 MB. In `FileTree.tsx` the sort uses `localeCompare(b, undefined, {numeric, sensitivity})` per comparison (a new collator each time), and all entries render as DOM rows with no virtualisation. A folder with a few thousand entries (for example `node_modules`) will stall the Redmi for seconds. Confidence: SUSPECTED (confirm by opening a 1.5 MB file and typing, and by listing a 5 000-entry folder on D1).

**W-31 (Low)** `EditorPane` applies `formatOnSave` only inside its Ctrl+S keymap (`handleSaveWithFormat`). The menu Save and the Run pre-save call `editor.save()` directly, so the setting is ignored on touch devices. **W-34 (Low)** `loadSettings` (`userSettings.ts:67-76`) spreads stored JSON over the defaults without checking types; a wrong-typed `bookmarks` or `recentFiles` throws during render (W-29). `showHiddenFiles`, `filterBinaryFiles`, `sortBy`, `openTabs`, `activeTab` are never read; `FileTree` keeps its own `leocode.sortBy`, `leocode.filterBinary`, `leocode.showHidden` keys. Persistence failures in `saveSettings` are swallowed silently.

## Files, prompts and storage

**W-15 (Medium) File list race.** `filesStore.refresh` (lines 26-39) has no request token. `navigate("a")` then `navigate("b")` quickly: if `a`'s `fs.list` returns after `b`'s, `entries` shows `a`'s content under `cwd = "b"`; `loading` is cleared by whichever finishes first. `navigate` also sets `cwd` before the list succeeds, so a failing path (`E_NOT_FOUND`, `E_PATH_OUTSIDE_ROOT`) leaves `cwd` pointing at a folder whose entries are the previous folder's, and "New file" then writes into the unlisted folder. Fix: token compare, assign `cwd` on success. Confidence: CONFIRMED BY READING.

**W-27 (Medium) Storage permission is not reachable.** `requestStoragePermission` and `getStorageInfo` exist but `Sidebar` discards `storageInfo` (`_storageInfo`) and nothing calls `requestStoragePermission`. The default bookmark is `/storage/emulated/0/Download` and the drawer has links to `/storage/emulated/0` and subfolders. Without the permission, each tap gives an `E_PATH_OUTSIDE_ROOT` sheet whose only action is Dismiss (catalog `action: dismiss`; the contract says "Open settings"). The user has no path to grant access from the UI. The `E_PERMISSION` and `E_DISK_FULL` sheets also say "Open Settings…" / "Free space" in the contract but have only Dismiss. Confidence: CONFIRMED BY READING.

**W-28 (Medium) Prompt validation.** `PromptDialog.submit` only trims and rejects empty. `submitPrompt` joins the value onto `cwd` unchanged, so names with `/` create nested paths on write/mkdir, `..` or `a/../b` is passed to the host (the jail catches escapes, so this is not a security hole), `.` makes a write to the directory path, reserved/long names go to the host. Rename with `/` in the value silently moves the file into another folder (the host's `rename` does `mkdirs`). The prompt closes immediately and in `finally`, so a failing name loses what the user typed and the error appears as a snackbar instead of the contract's inline field error. Dispatch on `prompt.title === "Save As"` is a string compare against a UI label. Confidence: CONFIRMED BY READING.

**W-32 (Low)** `FileTree.tsx:379` activates rows on `onPointerUp` with a 420 ms long-press timer and has no `onClick`, so Enter/Space on a focused row (hardware keyboard, switch access) does nothing. Touch scroll cancels the pointer, which is handled. **W-33 (Low)** `Sheet.tsx` renders the dialog and backdrop always and toggles a class; a closed sheet stays `role="dialog" aria-modal="true"` in the DOM, with pointer events disabled only through CSS, and there is no focus trap or focus restore. "New file here" in the context sheet of a folder creates in the current folder, not the long-pressed folder (Low).

## Run store

**W-13 (Medium) Python probe cached forever.** `runStore.ts:137-146` probes `python3 --version` once and stores `pythonReady`. If it fails (not installed yet, or a transient `E_TIMEOUT`), every later Run shows the "Python is not installed" hint until the page reloads, even after the user installs Python in Runtime Manager. Fix: probe each time while false, or invalidate on install completion. Confidence: CONFIRMED BY READING.

**W-14 (Medium) Old run affects the new run.** `queue` and `finish` close over shared `buffer`, `handle` and the store, not a run id. Scenario: Run a long script, close the sheet (cancel sent; host SIGTERM then SIGKILL after 2 s), press Run again within the grace period. Output of the old process still flows through `queue` into the new run's buffer, and when the old `bridge.run` promise resolves, `finish(code)` sets the new run to `running: false` with the old exit code and sets `handle = null`, so the new process can no longer be stopped. Also, two quick Run taps before the probe returns start two processes (the button is disabled only after `set({run})`). Confidence: CONFIRMED BY READING; the timing is SUSPECTED on device.

**W-38 (Low)** The Run sheet has no stdin, so `input()` blocks until Stop. Errors from `bridge.run` bypass the catalog and show raw `message`. `buffer` grows unbounded while `requestAnimationFrame` is paused (app in background) and a chatty process keeps running (SUSPECTED; the 200 000-character cap applies only at flush). Rendering one `<span>` per segment re-renders all spans each frame when stdout and stderr alternate (SUSPECTED perf).

## Terminal

**W-20 (Medium) No flow control.** `TerminalChannel.deliver` (`android.ts:605-609`) calls `onData(bytes)` then immediately acks the same byte count. `TerminalPane` passes `term.write(bytes)` with no completion callback. The host's 256 KB window therefore never throttles: `cat` on a large file or `yes` fills xterm's write queue, and xterm discards data beyond its watermark. Fix: ack in the `term.write(data, callback)` callback (and for hidden terminals, while paused). Confidence: CONFIRMED BY READING.

**W-21 (Medium) Stale geometry after attach.** After a successful `attachTerminal` the pane never sends a resize. The `[active]` effect (`TerminalPane.tsx:304-319`) fires 60 ms after mount, normally before the attach reply, when `handleRef.current` is still null. After a WebView recreation the PTY keeps its old rows/cols until a later layout change, which wraps output wrongly in full-screen programs. Fix: call `handle.resize(cols, rows)` right after attach. Confidence: CONFIRMED BY READING.

**W-22 (Medium) Failed attach starts a second shell.** `tryAttach` catches every error and returns false (`TerminalPane.tsx:192-194`), then `startPty` opens a new PTY and overwrites the saved session id. An attach `E_TIMEOUT` leaves the first shell running with no reference. The error is not reported. Confidence: CONFIRMED BY READING.

## Settings and theme

**W-30 (Low) Theme precedence.** `Shell.tsx:33-35` forces the theme provider to follow `settings.appTheme`, while `ThemeProvider` initialises from the host (`info.theme`) and `getTheme`. If the host holds `dark` and `leocode.user-settings` has no `appTheme` (default `"system"`, for example after an upgrade or cleared site data), the effect calls `setMode("system")` and `bridge.setTheme("system")`, overwriting the host's stored choice at boot. Three stores of the same value (`leocode.theme`, `appTheme`, the host). Confidence: SUSPECTED; confirm by setting dark, clearing only `leocode.user-settings`, and relaunching.

## Test coverage

Tests that assert something meaningful: `android.test.ts` (write timeout without retry, read retry with a late reply ignored, abort before and during flight, disconnect rejects pending, unknown code to `E_INTERNAL`), `catalog.test.ts` coverage and surface choices, `errorsStore.test.ts` routing, `surfaces.test.tsx` rendering and boundary reset, `runStore.test.ts` output and save-before-run.

Shallow or missing:
- `catalog.test.ts:36` "redacted" asserts nothing about redaction (W-09).
- `timeouts.test.ts` locks in the wrong `runtime.install` timeout (W-01).
- `android.test.ts` has no test for streams: `proc.run` exit and cancel, `term.open`/`term.attach` ordering, ack accounting, event for an unknown id, timeout of a streamed call, disconnect with an open stream, double handler, invalid base64.
- No test for save-while-typing (W-02), CRLF round trip (W-18), duplicate open (W-16), directory rename or delete (W-17), Save As collision (W-04), new-file collision (W-03), restore merge or transient failure (W-26), file-list race (W-15), run overlap (W-14), Python probe invalidation (W-13), back-button hook (W-12), snackbar flooding or `null` duration through the store (W-10), global handlers (W-11), `lazyWithRetry`, `PromptDialog` validation, `TerminalPane` at all, `FileTree` sort/filter, theme precedence (W-30).
- All store tests use `MockBridge`, which throws plain `Error`, so `E_NOT_FOUND`/`E_EXISTS`/`E_BINARY`/`E_LIMIT` handling is untested (W-36). The shell smoke tests only check that the mock boots.

**W-36 (Low) Mock parity.** `mock.ts:133-170` throws `Error("ENOENT: …")` instead of `AppError`, `write` over a directory succeeds, `rename` overwrites an existing target (host: `E_EXISTS`), `mkdir` on a file succeeds, `size` is `content.length` characters, no `E_BINARY` or `E_LIMIT`, and `openTerminal` returns null so the terminal always shows line mode.

## Claims in PROGRESS.md / reports that the code does not support

- Task 11 "disconnect() + `leocode:bridge-disconnected` → `E_BRIDGE_DISCONNECTED`": the method exists, nothing dispatches the event (W-07).
- Task 11 "streamed methods time the reply-on-start only": false for `runtime.install` against the real host (W-01).
- Task 12 "every silent `catch {}` replaced": remaining swallowing catches include `android.ts:289,321,364,446`, `ThemeProvider.tsx:85,102`, `TerminalPane.tsx:120,192,297,309`, `editorStore.ts` restore read (counts, but hides the code), `runStore.ts:140`, `RuntimeManager.tsx:208`, `saveSettings`, `copyText`. The plan's ESLint `no-empty` passes only because the blocks hold comments.
- Task 12 "Copy details … redacted" and plan 7.4/7.5: no redaction, and no correlation id, method, versions (W-09).
- Task 12 "undo-ready" notifications: the action field exists, nothing uses it; delete has no Undo.
- Task 12 "per-pane ErrorBoundary": three of seven panes (W-29).
- Plan 7.3 "File changed on disk · Reload / Keep mine", "Python not installed · Install" banner, `E_PERMISSION` "Open settings", `E_DISK_FULL` "Free space": not implemented (W-05, W-06, W-27).
- Task 13 "rename (tab followed)": true only for a single file (W-17).

## Checked and found correct

- `send()` removes the pending entry, timer and abort listener on every settle path; late replies after timeout, abort or disconnect are ignored; an already-aborted signal rejects before posting; abort after resolve is a no-op.
- The catalog has exactly one entry per generated code (read, all 24 present, typed `Record<ErrorCode, …>`).
- Unknown host codes map to `E_INTERNAL` and keep the message.
- Retry is limited to the listed reads and to `E_TIMEOUT`, so `fs.write` and streams are never double-executed.
- Snackbar timer is cleared on unmount and notice change; `ErrorSheet` has no reopen loop (`dismissSheet` only nulls state).
- Terminal title sanitiser, OSC 52 swallow, attach scrollback ordering, `TerminalView` boundary and retry.
- Run output cap is enforced at flush and drops the oldest text.
- CSP: no inline script, fonts bundled; the Vite plugin injects the strict policy for builds (`security.test.ts`).
- `?simulate=` is gated on `bridge.mode === "mock"`, and `createBridge` returns the mock only when no channel is injected and the origin is not `appassets.androidplatform.net`, so it is not reachable on device.
- Retry set (`app.info`, `app.theme.get`, `fs.list`, `fs.read`, `storage.info`, `term.list`) retries once on `E_TIMEOUT` only with a fresh id; `fs.write` is never retried.
- Terminal: OSC 0/2 titles sanitised, OSC 52 swallowed, attach holds live data until scrollback is written, unmount detaches without killing the PTY.

Not read in full: `Sidebar.tsx`, `SettingsDialog.tsx`, `EditorMenus.tsx`, `Icons.tsx`, `editorThemes.ts`, and the UI half of `RuntimeManager.tsx` (searched for error handling, install and permission calls only). The 48 dp target sizes and focus behaviour were not verified in CSS.

</details>

<details>
<summary>File map</summary>

- `web/src/bridge/android.ts`: real bridge, timeouts, retry, terminal channel (W-01, 07, 08, 20, 23, 37)
- `web/src/bridge/timeouts.ts`: timeout and idempotency tables (W-01)
- `web/src/bridge/mock.ts`: browser mock (W-36)
- `web/src/errors/catalog.ts`, `errorsStore.ts`, `ErrorSheet.tsx`, `ErrorSurfaces.tsx`, `Snackbar.tsx`, `globalHandlers.ts`, `lazyWithRetry.ts`: error routing and surfaces (W-05, 09, 10, 11, 35)
- `web/src/notifications/notificationsStore.ts`: snackbar queue (W-10)
- `web/src/features/editor/editorStore.ts`, `model.ts`, `EditorView.tsx`: tabs, save, restore (W-02, 04, 16-19, 24, 26)
- `web/src/features/files/filesStore.ts`, `FilesView.tsx`, `ExplorerDrawer.tsx`; `components/FileTree.tsx`, `Sidebar.tsx`: file list and navigation (W-15, 25, 27, 32)
- `web/src/features/shell/Shell.tsx`, `promptActions.ts`, `shellStore.ts`; `components/PromptDialog.tsx`: back hook and prompts (W-03, 12, 28, 30)
- `web/src/features/run/runStore.ts`; `components/RunSheet.tsx`: run lifecycle (W-13, 14, 38)
- `web/src/components/TerminalPane.tsx`, `features/terminal/session.ts`: terminal (W-21, 22)
- `web/src/components/Sheet.tsx`, `EditorPane.tsx`; `settings/userSettings.ts`; `theme/ThemeProvider.tsx` (W-31, 33, 34)

Full diff: `git diff 542e14e..HEAD -- web/src web/index.html web/package.json`

</details>
