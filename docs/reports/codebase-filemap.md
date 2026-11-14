# LeoCode — Codebase File Map (Phase D baseline)

**Generated:** 2026-11-14
**Status:** Phase D implemented and green on the JVM/web gates; device pass pending.
See [`task14-16-verification.md`](task14-16-verification.md).
**Purpose:** a navigational map of every source file that matters for Phase D
(Tasks 14–16). Generated bundles under `android/app/src/main/assets/web/`
and Gradle output directories are omitted.

## How to read this

| Column / marker | Meaning |
|---|---|
| `[host]` | Kotlin, runs in the Android app process |
| `[web]` | TypeScript/React, runs in the WebView |
| `[native]` | C, packed into `libleocodepty.so` |
| `[test]` | JVM unit test or Vitest test |
| `[doc]` | Contract, plan or tracker |
| `[script]` | Device/build helper |
| `(D14)` `(D15)` `(D16)` | Touched by Phase D Task 14/15/16 |

## Top level

```
leocode/
├── PROGRESS.md                        [doc] live task tracker
├── README.md                          [doc] project overview
├── docs/
│   ├── LeoCode_Implementation_Plan_v9.md   [doc] source of truth (Tasks 1–33)
│   ├── bridge-contract.md                  [doc] WebView ↔ Kotlin protocol
│   ├── ux-spec.md                          [doc] shell, editor, error surfaces
│   ├── test-matrix.md                      [doc] D1/D2 device results
│   ├── phase0-runbook.md                   [doc] device preparation
│   ├── compatibility.md                    [doc] Python matrix (Phase G)
│   ├── decisions/README.md                 [doc] D-001 … D-017
│   ├── reports/                            [doc] phase reviews + verification
│   │   ├── phase-a-analysis.md
│   │   ├── phase-b-c-analysis.md
│   │   ├── phase-b-c-fixes.md
│   │   ├── task14-16-verification.md
│   │   ├── phase-d-analysis.md               Phase D bug/edge-case review (PD-01…PD-25)
│   │   └── codebase-filemap.md             ← this file
│   └── device-reports/                     [doc] raw device logs
├── android/                                Gradle project
├── web/                                    Vite + React + CodeMirror app
├── scripts/                                device/build helpers
├── design/                                 icon and mascot artwork
└── runtime-manifests/                      Python runtime manifests (Phase G)
```

## Android host (`android/app/src/main/java/dev/leocode/`)

```
dev/leocode/
├── LeoApp.kt                     [host] Application, AppGraph construction, crash install,
│                                        renderer-loss tracker
├── AppGraph.kt                   [host] manual DI: workspace, jail, trash, processes,
│                                        terminals, handlers (D14 adds WorkspaceStore,
│                                        Drafts, SearchEngine; D15 adds draft/hash plumbing)
├── MainActivity.kt               [host] WebView host, ActivityResult queues, SafPort,
│                                        router registration (D14 SAF tree/import/export,
│                                        D15 file-change-safe AFK, D16 no change)
├── BridgeHost.kt                 [host] WebView transport, origin check, 8 MB cap,
│                                        reply/event posting
├── RecoveryActivity.kt           [host] native crash/recovery screen
├── SessionService.kt             [host] foreground service for PTYs/jobs
├── ThemeManager.kt               [host] system-bar + theme sync
├── DevServerConfig.kt            [host] debug-only Vite origin
├── bridge/
│   ├── Contract.kt               [host] serializable DTOs (generated into TS) (D14–D16)
│   ├── BridgeTypesGenerator.kt   [host] writes web/src/bridge/types.gen.ts
│   ├── BridgeJson.kt             [host] one Json config (encodeDefaults)
│   ├── Envelope.kt               [host] request/event envelope helpers
│   ├── ErrorCode.kt              [host] typed error codes (single source)
│   ├── BridgeException.kt        [host] typed handler failure
│   ├── BridgeHandler.kt          [host] sync handler + StreamingBridgeHandler
│   ├── AsyncBridgeHandler.kt     [host] async one-reply handler
│   ├── BridgeRouter.kt           [host] validation, dispatch, typed/redacted errors
│   ├── StreamSink.kt             [host] per-request event sink
│   ├── EventSink.kt              [host] 16 ms text/byte coalescer
│   ├── SafeEnvelope.kt           [host] request-id validation
│   ├── AppHandler.kt             [host] app.* (ping, info, theme)
│   ├── FsHandler.kt              [host] fs.list/read/write/mkdir/rename/delete
│   │                                     (D15 chunked read + stat + hash)
│   ├── WorkspaceHandler.kt       [host] workspace.list/create/open/rename/delete (D14)
│   ├── DraftHandler.kt           [host] draft.list/read/save/delete (D15)
│   ├── SearchHandler.kt          [host] fs.search streaming + cancel (D16)
│   ├── SafHandler.kt             [host] saf.* / storage.* (D14 import/export/restore)
│   ├── SafPort.kt                [host] platform picker interface implemented by MainActivity
│   ├── ProcHandler.kt            [host] proc.run/proc.cancel
│   ├── TermHandler.kt            [host] term.open/attach/list/write/resize/ack/close
│   └── RuntimeHandler.kt         [host] runtime.install/cancel
├── core/
│   ├── Workspace.kt              [host] app-private storage layout + child env
│   ├── PathJail.kt               [host] canonical path validation
│   ├── AtomicWriter.kt           [host] temp → fsync → rename
│   ├── Trash.kt                  [host] recoverable delete + 30-day purge
│   ├── FileHash.kt               [host] SHA-256 helpers for stat/conflict (D15)
│   ├── ProcessSupervisor.kt      [host] one process-launch path
│   ├── ChildEnv.kt               [host] child environment allowlist
│   ├── Pty.kt                    [host] JNI PTY wrapper
│   ├── TerminalRegistry.kt       [host] PTY ownership outside the Activity
│   ├── RingBuffer.kt             [host] per-session scrollback
│   ├── OrphanReaper.kt           [host] stale process-group cleanup
│   ├── PidFileStore.kt           [host] pid + start-time records
│   ├── ProcessStartTime.kt       [host] /proc start-time guard
│   ├── CrashStore.kt             [host] crash file writer
│   ├── Redactor.kt               [host] log/diagnostic redaction
│   ├── DeviceReport.kt           [host] device fields for app.info
│   └── RuntimeInstaller.kt       [host] Python prototype installer (Task 25 replaces)
├── workspace/
│   ├── WorkspaceStore.kt         [host] multiple projects, recent list, active root (D14)
│   ├── Drafts.kt                 [host] autosaved unsaved buffers + recovery (D15)
│   ├── SearchEngine.kt           [host] cancellable, capped workspace search (D16)
│   └── ZipBackup.kt              [host] zip export/restore + folder copy helpers (D14)
├── Java resources
│   └── (none yet)
└── debug/java/dev/leocode/
    ├── HarnessActivity.kt        [host] T1–T15 harness, debug only
    └── HarnessProcess.kt         [host] harness adapter on ProcessSupervisor
```

## WebView app (`web/src/`)

```
web/src/
├── main.tsx                      [web] React entry
├── App.tsx                       [web] boot: bridge, stores, error handlers, Shell
├── csp.ts                        [web] CSP string builder
├── security.test.ts              [test] CSP + redaction checks
├── vite-env.d.ts
├── app/
│   └── stores.tsx                [web] manual DI store graph + context (D14/D15/D16 stores)
├── bridge/
│   ├── index.ts                  [web] bridge factory + public exports
│   ├── android.ts                [web] WebView transport, timeouts, streams (D14–D16)
│   ├── mock.ts                   [web] in-memory browser bridge (D14–D16)
│   ├── types.ts                  [web] Bridge surface + generated re-exports (D14–D16)
│   ├── types.gen.ts              [web] GENERATED from Contract.kt
│   ├── timeouts.ts               [web] per-method timeout policy
│   ├── limits.ts                 [web] shared transport limits
│   ├── *.test.ts                 [test] transport, mock, generated, timeouts
│   └── mock.phaseD.test.ts       [test] Phase D mock parity (D14–D16)
├── errors/
│   ├── AppError routing, catalog, boundaries, sheets, banners, snackbars
│   ├── catalog.ts                [web] every ErrorCode → copy/actions/severity
│   ├── errorsStore.ts            [web] banner/sheet routing
│   ├── InlineBanner.tsx          [web] recoverable banner (D15 conflict/draft use)
│   ├── ErrorSurfaces.tsx
│   └── *.test.*                  [test]
├── notifications/
│   └── notificationsStore.ts     [web] snackbar queue with actions/undo
├── settings/
│   └── userSettings.ts           [web] persisted user settings
├── theme/
│   └── ThemeProvider.tsx         [web] theme + system bars
├── components/
│   ├── EditorPane.tsx            [web] CodeMirror pane (D15 large-file/find-replace)
│   ├── EditorMenus.tsx           [web] File/Edit/Overflow menus (D15 find/replace entry)
│   ├── FileTree.tsx              [web] file rows
│   ├── Sidebar.tsx               [web] drawer: storage, bookmarks, recents, tree
│   ├── SettingsDialog.tsx        [web] settings + about (D14 backup/uninstall warning)
│   ├── RunSheet.tsx              [web] run output
│   ├── TerminalPane.tsx          [web] xterm view
│   ├── RuntimeManager.tsx        [web] runtime catalogue UI
│   ├── Sheet.tsx                 [web] bottom sheet primitive (D15 find/replace,
│   │                                     D16 search panel; closed sheets are aria-hidden)
│   ├── FindReplaceSheet.tsx      [web] find/replace form (D15)
│   ├── SearchPanel.tsx           [web] streaming workspace results + jump-to-line (D16)
│   ├── PromptDialog.tsx          [web] text prompt
│   └── Icons.tsx                 [web] inline SVG icon set
├── features/
│   ├── shell/
│   │   ├── Shell.tsx             [web] frame composition + global back + focus hooks
│   │   ├── shellStore.ts         [web] active view, drawer, sheets, prompts
│   │   ├── back.ts               [web] Android back mapping
│   │   ├── sheetStack.ts         [web] ordered sheet stack
│   │   ├── promptActions.ts      [web] prompt → fs actions
│   │   └── *.test.ts
│   ├── files/
│   │   ├── filesStore.ts         [web] cwd, entries, storage permission
│   │   ├── FilesView.tsx         [web] explorer pane
│   │   ├── ExplorerDrawer.tsx    [web] drawer wiring
│   │   └── *.test.ts
│   ├── editor/
│   │   ├── editorStore.ts        [web] tabs, save, session, drafts, conflicts (D15)
│   │   ├── model.ts              [web] OpenDoc, EOL, large-file fields, path helpers (D15)
│   │   ├── EditorView.tsx        [web] tabs + panes + large-file/draft/conflict banners (D15)
│   │   ├── commands.ts           [web] window-event editor commands (D15 goto/find-replace)
│   │   ├── findReplaceStore.ts   [web] find/replace sheet state → editor commands (D15)
│   │   ├── editorPhaseD.test.ts  [test] large file, drafts, external change, find/replace
│   │   └── *.test.ts
│   ├── workspace/
│   │   ├── workspaceStore.ts     [web] list/create/open/rename/delete switching (D14)
│   │   ├── WorkspaceSwitcher.tsx [web] top-bar workspace dropdown (D14)
│   │   └── workspaceStore.test.ts [test]
│   ├── search/
│   │   ├── searchStore.ts        [web] streaming search state, cancel, jump (D16)
│   │   └── searchStore.test.ts   [test]
│   ├── terminal/
│   │   ├── TerminalView.tsx
│   │   └── session.ts
│   ├── run/
│   │   ├── runStore.ts           [web] run sheet, save-before-run, stop
│   │   └── *.test.ts
│   ├── layout/
│   │   ├── AppHeader.tsx         [web] brand, menus, workspace switcher (D14)
│   │   ├── AppStatusBar.tsx
│   │   ├── AppDialogs.tsx        [web] all sheet/dialog hosts (D14–D16)
│   │   └── BottomNav.tsx
│   ├── runtimes/RuntimesView.tsx
│   └── settings/settingsStore.ts [web] persisted settings store
└── styles/
    ├── index.css                 imported in cascade order
    ├── tokens.css, base.css, layout.css, buttons.css, menus.css,
    │   sheets.css, prompt.css, drawer-explorer.css, drawer-nav.css,
    │   files.css, tabs.css, editor.css, keys.css, terminal.css, run.css,
    │   runtimes.css, settings.css, settings-dialog.css, statusbar.css,
    │   errors.css, responsive.css, splash.css
    └── workspace.css             [web] switcher, find/replace, search panel, backup (D14–D16)
```

## Native (`android/app/src/main/cpp/`)

```
cpp/
├── CMakeLists.txt                [native] builds libleocodepty.so
├── pty.c                         [native] clean fork/execve PTY child
└── python_launcher.c             [native] Python launcher prototype (Task 24 replaces)
```

## Tests (`android/app/src/test/java/dev/leocode/`)

```
bridge/
├── BridgeJsonTest.kt
├── BridgeRouterTest.kt
├── EventSinkTest.kt
├── FsHandlerTest.kt              [test] fs round-trip, jail, limits, UTF-8, symlinks
├── WorkspaceHandlerTest.kt       [test] workspaces + zip backup (D14)
├── DraftHandlerTest.kt           [test] draft round-trip + recovery (D15)
├── SearchHandlerTest.kt          [test] search matches, ignores, caps, cancel (D16)
├── SafHandlerTest.kt             [test] SAF pickers + import/export ports (D14)
├── SafeEnvelopeTest.kt
├── BridgeHostOriginTest.kt
└── types/
    ├── BridgeTypesCoverageTest.kt
    └── GenerateBridgeTypes.kt
core/
├── WorkspaceJailTest.kt
├── PathJailTest.kt
├── AtomicWriterTest.kt
├── TrashTest.kt
├── FileHashTest.kt               [test] hash/mtime awareness (D15)
├── ProcessSupervisorTest.kt
├── ChildEnvTest.kt
├── RingBufferTest.kt
├── TerminalRegistryTest.kt
├── OrphanReaperTest.kt
├── CrashStoreTest.kt
└── RedactorTest.kt
workspace/
├── WorkspaceStoreTest.kt         [test] create/open/rename/delete/recent (D14)
├── DraftsTest.kt                 [test] write/list/read/delete + caps (D15)
├── SearchEngineTest.kt           [test] fixture tree search (D16)
└── ZipBackupTest.kt              [test] zip round-trip + zip-slip rejection (D14)
```

## Scripts and CI

```
scripts/
├── devices.sh                    [script] serial resolution + device facts
├── device.sh                     [script] repeatable adb run helper
├── smoke.sh                      [script] install + cold start + logcat
├── collect-device-report.sh      [script] raw device report
├── sync-web.sh                   [script] copy web/dist into assets
├── check-elf-alignment.sh        [script] 16 KB ELF/zipalign gate
├── sign-manifest.sh / verify-manifest.sh   [script] runtime manifest signing
├── build-python*.sh              [script] Python prototype (Tasks 24–25)
└── tests/run-elf-alignment-tests.sh
.github/workflows/ci.yml          jobs: web, android, nightly, python-runtime
```

## Phase D data flow

```
Workspace switcher (D14)
  web workspaceStore → workspace.list (active + records)/create/open/rename/delete
  → WorkspaceHandler → WorkspaceStore (registry filesDir/workspaces.json,
    directories workspace/workspaces/<id>; default is never deleted)
  → FsHandler/PathJail resolve relative paths against the active workspace root
  → switching clears buffers and re-lists the explorer from "."

Import / export / restore (D14)
  Settings → saf.importTree → SafPort tree picker → copy into the workspace
    (never overwrites an existing name) + saf.progress
  Settings → saf.exportWorkspace → SAF create picker → ZipBackup streams the
    active workspace out + saf.progress
  Settings → saf.restoreArchive → SAF open picker → ZipBackup validates entry
    names and caps, then streams each entry to a unique temp file and moves it
    into place (REPLACE_EXISTING) + saf.progress

Drafts + recovery (D15)
  editorStore change → 3 s idle → draft.save
  → DraftHandler → Drafts (filesDir/drafts/<workspaceId>/<sha256(path)>.json)
  open file → draft.read → InlineBanner "Unsaved draft found · Restore / Discard"
  successful save or tab close → draft.delete

External change (D15)
  Shell polls fs.stat for open buffers every 5 s while the editor is visible
  → compare mtime + SHA-256 with the OpenDoc baseline
  → InlineBanner "File changed on disk · Reload / Keep mine"
  save includes expectedHash → mismatch is E_CONFLICT (no silent overwrite)
  Keep mine refreshes the baseline; a deleted file is recreated on save

Large file (D15)
  fs.stat → size > 1 MB → one chunked fs.read(offset 0, maxBytes 1 MB)
  → read-only pane + banner; save is disabled (a truncated buffer is never written)

Search (D16)
  fs.search(searchId, query, glob?, caseSensitive?, maxResults?)
  → SearchHandler → SearchEngine (ignores .git/node_modules/.venv, capped)
  → search.match events stream into SearchPanel; a row opens the file and
    dispatches the gotoPosition editor command
  fs.search.cancel(searchId) when the sheet closes or a new search starts
```

## Phase D contract additions

| Method | Payload → Reply | Notes |
|---|---|---|
| `workspace.list` | `{}` → `{ active, workspaces: WorkspaceInfo[] }` | default first, then recent |
| `workspace.create` | `{ name }` → `{ id, name, path }` | unique id |
| `workspace.open` | `{ id }` → `{ id, name, path }` | updates recent; becomes active root |
| `workspace.rename` | `{ id, name }` → `{}` | display name only |
| `workspace.delete` | `{ id }` → `{}` | moves to trash; `default` refused |
| `fs.stat` | `{ path }` → `{ path, kind, size, mtime, hash }` | conflict detection |
| `fs.read` | `{ path, offset?, maxBytes? }` → `{ path, content, size, nextOffset, mtime, hash }` | `nextOffset` -1 at EOF |
| `fs.write` | `{ path, content, expectedHash? }` → `{ path, size, mtime, hash }` | stale baseline → `E_CONFLICT` |
| `fs.search` | `{ searchId, query, glob?, caseSensitive?, maxResults? }` → `{ count, truncated }` + `search.match` | cancellable |
| `fs.search.cancel` | `{ searchId }` → `{ cancelled }` | safe after completion |
| `draft.list` | `{}` → `DraftInfo[]` | active workspace |
| `draft.read` | `{ path }` → `{ path, content, eol, mtime }` or `null` | |
| `draft.save` | `{ path, content, eol }` → `{}` | atomic, 4 MB cap |
| `draft.delete` | `{ path }` → `{}` | |
| `saf.importTree` | `{ dest? }` → `{ path, files, bytes }` + `saf.progress` | folder copy-in |
| `saf.exportWorkspace` | `{}` → `{ name, uri, files, bytes }` + `saf.progress` | zip copy-out |
| `saf.restoreArchive` | `{ confirm: true }` → `{ files, bytes }` + `saf.progress` | safe zip restore |

## Phase D verification (2026-11-14)

Automated gates run locally; device rows in `docs/test-matrix.md` stay pending.

| Gate | Result |
|---|---|
| `./gradlew testDebugUnitTest` | **PASS** — 252 tests (new: `WorkspaceStoreTest`, `DraftsTest`, `SearchEngineTest`, `ZipBackupTest`, `FileHashTest`, `WorkspaceHandlerTest`, `DraftHandlerTest`, `SearchHandlerTest`, expanded `SafHandlerTest`) |
| `./gradlew generateBridgeTypes` | **PASS** — `web/src/bridge/types.gen.ts` regenerated from `Contract.kt` |
| `npm test` | **PASS** — 37 files, 224 tests (new: `mock.phaseD.test.ts`, `workspaceStore.test.ts`, `searchStore.test.ts`, `editorPhaseD.test.ts`) |
| `npm run typecheck` / `npm run lint` | **PASS** |
| `npm run build` | **PASS** (existing >500 kB chunk warning only) |

Bugs the tests caught and were fixed:

- `ReadReply.size` was `Int` while `FileEntry.size` is bytes/`Long`.
- `ZipBackup.restore` lost the last block because a buffered output stream was
  never closed; it now streams each entry into a unique `.tmp` file and moves
  it into place atomically, so a failed restore never leaves a partial file.
- A closed `Sheet` stayed in the accessibility tree (duplicate `role="status"`).
- Keep mine set `saved: null`, which made Save open the Save As prompt; Save now
  keys the prompt on `isUntitled` only, and a deleted file is recreated.
