# Task 13 verification — features and stores

**Date:** 2026-11-14 · **Branch:** `v9-impl` · **Plan:** [v9 §15](../LeoCode_Implementation_Plan_v9.md) Task 13

## What changed

### `App.tsx` → boot only

`App.tsx` (128 lines) now only connects the bridge, builds the store graph, installs the
global error handlers and renders the shell inside an `ErrorBoundary`/`CrashScreen`.
Everything else moved to `features/*`:

| Feature | Files |
|---|---|
| Shell | `features/shell/Shell.tsx` (84 lines), `shellStore.ts`, `promptActions.ts` |
| Files | `features/files/filesStore.ts`, `FilesView.tsx`, `ExplorerDrawer.tsx` |
| Editor | `features/editor/model.ts`, `editorStore.ts`, `EditorView.tsx`, `commands.ts` |
| Terminal | `features/terminal/TerminalView.tsx`, `session.ts` |
| Run | `features/run/runStore.ts` |
| Runtimes | `features/runtimes/RuntimesView.tsx` |
| Settings | `features/settings/settingsStore.ts` |
| Layout | `features/layout/AppHeader.tsx`, `BottomNav.tsx`, `AppStatusBar.tsx`, `AppDialogs.tsx` |
| Notifications/errors | existing `notifications/` and `errors/` modules |

### Zustand stores (D-015)

`createAppStores(bridge)` (manual DI) builds one vanilla store per domain:
`settings`, `shell`, `files`, `editor`, `run`, plus `notifications` and `errors`.
Stores are provided through `StoresProvider`; views read with `useStore` and call actions
through `getState()`. Editor, files and run depend only on the store interfaces passed to
their factories, so tests create an isolated graph against a fake or mock bridge.

- **Settings** replaces the per-component hook (same storage key and event bridge).
- **Shell** owns view, drawer, settings sheet, terminal mount, prompt and the 2.2 s status
  flash. The Android back order is unchanged.
- **Files** owns cwd/entries/loading/storage and reports list failures.
- **Editor** owns docs, active path, open/save/save-as/reload/close/close-all, session
  restore and deletion; a store subscription persists the session.
- **Run** owns the sheet, output coalescing, the 200k cap, save-before-run and the Python
  probe.

### Styles split

`styles.css` (2 953 lines) became `styles/*.css` (22 feature files) with `styles/index.css`
importing them in the original order. `main.tsx` imports the index.

### Terminal hardening

- Session id persistence moved to `features/terminal/session.ts` (same
  `leocode.terminal.session` key) with try/catch for blocked storage.
- OSC 0/2 titles are sanitised (`sanitizeTerminalTitle`: strips OSC/CSI/control characters,
  collapses whitespace, caps at 80) and shown in the terminal chrome; OSC 52 (clipboard
  writes from a program) is swallowed with `registerOscHandler(52, …)`.

## Tests

| File | Covers |
|---|---|
| `features/files/filesStore.test.ts` (2) | mock root listing, navigation, error reporting |
| `features/editor/editorStore.test.ts` (5) | open + recents, dirty save, Save-As prompt for untitled, session restore + missing-tab warning, close-all confirmation |
| `features/run/runStore.test.ts` (4) | mock Python run + output, unsupported type warning, save-before-run, close |
| `features/terminal/session.test.ts` (2) | title sanitisation and session-id round-trip |
| `features/shell/shell.test.tsx` (2) | mock-mode boot/list/empty state and switching to the terminal view |
| Existing | bridge, errors, catalog, surfaces, simulate, security, settings, generated types |

Suite total: **57 tests passing**; `lint` 0 problems; `tsc --noEmit` clean; production build
succeeds. Shell is 84 lines (target < 200).

## Device parity on D1 (Redmi Note 7S, Android 9)

Built from the synced bundle and installed; screenshots in `docs/device-reports/`:

| Step | Result |
|---|---|
| Cold start + shell layout | **PASS** — `...-164116-t13-home-...png` |
| Explorer drawer with workspace files | **PASS** — `...-164151-t13-drawer-...png` |
| Open `hello.sh` in the editor (tab, highlighting, keyboard tools) | **PASS** — `...-164236-t13-editor3-...png` |
| Run `hello.sh` | **PASS** — Run sheet, `EXIT 0`, `start` / `should-not-print` — `...-164315-t13-run-done-...png` |
| Terminal | **PASS** — real PTY, prompt, key row — `...-164354-t13-terminal-...png` |
| Runtimes | **PASS** — probe results and runtime cards — `...-164501-t13-runtimes2-...png` |
| Rename a file | **PASS** — row menu → Rename → prompt; `hello.sh` became `hello-renamed.sh` on disk and the open tab followed — `...-164726-t13-rowmenu-...png`, `...-164814-t13-renamed-...png` |
| Delete a file | **PASS** — row menu → Delete → confirm; the tab closed and the file moved to `files/.trash/1794655229030-…-hello-renamed.sh` — `...-164947-t13-delete-confirm-...png`, `...-165031-t13-deleted-...png` |

Theme switching, undo/redo and Save were exercised in earlier Phase 1 runs; their code paths
are unchanged (settings store + editor commands keep the same events).

## Known gaps

- The Run sheet and terminal are separate views from the editor; switching tabs closes the
  keyboard, which the device script accounts for.
- GitHub Actions has still not been observed running.
