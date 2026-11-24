# LeoCode — UX Specification (MVP)

Portrait-first. Landscape supported for the editor and terminal, nothing depends on it.

## Shell

```
┌──────────────────────────────────────────────┐
│  LeoCode   project ▾            ⟳  ⋮         │  top bar (48 dp)
├──────────────────────────────────────────────┤
│                                              │
│                  active view                 │  Files / Editor / Terminal / Git
│                                              │
├──────────────────────────────────────────────┤
│  Files   Editor   Terminal   Git    More     │  bottom nav, 56 dp, always visible
└──────────────────────────────────────────────┘
```

Bottom nav is fixed; the view above it owns its own scrolling. The soft keyboard must never hide
the nav or the active input: every view observes `visualViewport` and resizes its height.

## Files

- Tree, not tabs. Row height 56 dp. Chevron for folders, icon by extension, size + mtime in a
  second line only for files > 1 MB.
- Tap = open in editor. Long-press = context sheet (Rename, Move, Delete, Copy path, Share).
- Swipe-left reveals Delete; destructive actions require an undo snackbar (5 s), except delete of
  a folder, which requires confirmation.
- Toolbar: new file, new folder, search, hidden-files toggle, import (SAF), export workspace.
- Empty state: "Create a file" + "Import from device" + "Clone a repository".

## Editor

- Tab strip above the gutter: scrollable, 40 dp, dirty dot instead of a close icon until hover/long-press.
- Breadcrumb under the tabs, ellipsised from the left.
- Gutter line numbers, relative guide lines off by default (4 GB devices).
- Keyboard accessory row pinned above the IME: `Tab · Ctrl · Esc · ← ↑ ↓ → · { } · " · /`.
  Long-press `Ctrl` latches for one keystroke.
- Find/replace as a bottom sheet, not a dialog, so the keyboard stays up.
- Save: explicit (checkmark) plus autosave every 3 s after idle when a draft exists.
- Crash recovery: on reopen, offer "Restore unsaved changes (3 files)" before showing the workspace.
- External change (Git checkout / terminal edit): banner "File changed on disk — Reload / Keep mine".
- Large files: > 1 MB opens with syntax highlighting off and a banner offering to enable it.

## Terminal

- Full-height view; the keyboard reduces it via `visualViewport`, never overlaps it.
- Extra-keys row above the IME: `Ctrl · Esc · Tab · ← ↑ ↓ → · | · ~ · -`.
- Scrollback capped at 5 000 lines; "Clear" in the overflow menu.
- Long-press selects; copy/paste only through the system menu. OSC 52 writes are ignored.
- Session chip when > 1 session; closing a session kills its process group with confirmation if a
  process is still alive.
- If the app is backgrounded, a foreground-service notification shows "1 process running".

## Git

- Status list grouped Staged / Changes / Untracked. Swipe to stage/unstage. Tap for diff.
- Diff view: unified, monospace, side-by-side only in landscape. No horizontal scroll for code
  lines under 100 chars.
- Commit box pinned above the keyboard: message + "Commit" (disabled when nothing is staged).
- Toolbar: branch chip (tap = branch sheet), pull, push, overflow (log, remotes, discard).
- Conflicts: file-level badge, "Open in editor" shows conflict markers with an inline accept-ours/
  accept-theirs action per block.

## Runtime installation

- Persistent banner in the editor when the project's runtime is missing:
  `Python 3.11 not installed · 142 MB · Install`.
- Install sheet: size, version, what will work (pure Python) and what will not (native packages
  without a wheel), disk space check, resumable progress, cancel.
- After install: health check runs automatically with a visible result; failure offers Repair.

## Onboarding (3 screens, skippable except where noted)

1. **How files work** — projects live inside LeoCode; shared storage can be browsed when the storage
   permission is granted; import/export via the system picker; uninstall deletes private projects
   (export or back up first).
2. **Keep sessions alive** — Android 12+ and MIUI kill background processes:
   - MIUI: Battery → No restrictions; Security → Autostart on (deep-link where Android allows).
   - Android 12+ phantom-process killer: explain that long jobs may be stopped when LeoCode is in the
     background; the foreground notification reduces this.
   - Rooted phones only, behind a button: "Disable the background process limit" (runs
     `device_config put activity_manager max_phantom_processes 2147483647` after a confirmation).
3. **Trust model** — code you run has the same access as LeoCode itself. Only run projects you trust.
   This is the D-008 warning and cannot be skipped silently (requires "I understand").

Root mode is **not** part of onboarding; it is never mentioned to users whose device has no `su`.

## Root mode (D-011)

- **Location:** Settings › Advanced › Root mode. On devices without `su` the row reads
  "Root not available on this device" and is disabled.
- **Enabling:** toggle → warning sheet ("Commands run as root can change or break your system.
  LeoCode cannot undo them.") with **Enable root mode** / Cancel → system `su` grant dialog.
  Denied → sheet with `E_ROOT_DENIED` copy and **Try again**.
- **Badge semantics (R-10):**
  - **Header:** displays a small `ROOT MODE` chip whenever root mode is enabled (mode indication).
  - **Terminal tabs, run sheet, and status bar:** display the red `# ROOT` badge **only while a root process is alive** (`liveRootCount > 0`, or that specific tab/job is root and running).
- **Root terminal:** terminal session chip menu gains "New root session". Root tabs use a red-tinted
  chip and a `# ROOT` badge while alive; the prompt shows `#`.
- **Run as root:** a toggle on the run sheet, off by default, reset per run. When on, the Run button
  label becomes "Run as root".
- **Loss behaviour (R-03 / R-05):**
  - A running root shell keeps uid 0 after a revoke; the next root operation fails with
    `E_ROOT_DENIED` and a `root.lost` banner.
  - A `root.lost` whose `sessionId` matches the current root terminal marks that tab ended and shows
    an inline banner: "Root access was refused. The root session ended." with **Try again**
    (`requestRoot`) and **Open normal shell**.
  - A `root.lost` whose `jobId` matches the current run displays an inline banner in the run sheet
    with **Try again**. Note: run-sheet Try again re-runs the file directly (`onRetryRoot = runFile`) without requesting root first; after a loss the host returns `E_ROOT_DENIED` right away, whose error-sheet retry then triggers `retryRoot`.
- **Phantom-process option (R-09):**
  - In Settings › About under Background survival: on Android 12+ (SDK ≥ 31) when root mode is enabled
    and the store is not in a lost state, shows an **Apply until reboot** button.
  - Tap → confirm dialog: "Raises Android's background child-process limit until the next reboot.
    LeoCode runs this as root: `device_config put activity_manager max_phantom_processes 2147483647`."
    Buttons: Apply / Cancel.
  - Apply runs `proc.run { argv: ["/system/bin/sh", "-c", "device_config put activity_manager max_phantom_processes 2147483647 && device_config get activity_manager max_phantom_processes"], root: true, timeoutMs: 15000 }`
    and shows success with the value read back, or routes errors through normal error routing.
  - Never run automatically, and never persisted across reboots.
- **Never:** prompt at startup, browse files as root, or remember "Run as root" across runs.

## Error surfaces

Inline, actionable, never a raw stack trace. Every error code maps to one surface and one copy
entry in `web/src/errors/catalog.ts`. Look: Material 3 (rounded 16 dp sheets, 12 dp banners,
elevation only on snackbars), theme-aware tokens, error colour only on the icon and primary
destructive action, never full red backgrounds.

### Which surface

| Severity | Surface | Behaviour | Use for |
|---|---|---|---|
| Info / transient | **Snackbar** | Bottom, above the nav and keyboard; 4 s (8 s with an action); one action max; queued, never stacked | Done actions, cancellations, undo ("Moved to trash · Undo") |
| Recoverable | **Inline banner** | Top of the affected pane; stays until resolved or dismissed; up to two actions | Missing runtime, file changed on disk, offline, restored after a crash, large-file mode |
| Blocking | **Error sheet** | Bottom sheet; icon, title, one-paragraph explanation, one primary action, secondary "Copy details", Close | Save failed, auth failed, permission needed, host key changed |
| Fatal (pane) | **Pane error boundary** | Replaces only the broken pane: "This panel stopped working" · **Reload panel** · Copy details; other panes keep working | React render crash in editor, terminal, Git, etc. |
| Fatal (app, web) | **CrashScreen** | Full screen inside the WebView: **Reload app** · Copy details | Crash in the shell itself |
| Fatal (host) | **RecoveryActivity** | Native screen, works without the WebView: "LeoCode closed unexpectedly" · **Restart** · Share diagnostics; offers draft recovery on restart | Uncaught Kotlin exception, repeated renderer loss |

Blocking errors never use a snackbar. Transient information never opens a sheet.
`E_CANCELLED` shows nothing unless the user would otherwise think the action is still running.

### Copy rules

- **Title:** what failed, in the user's terms ("Couldn't save main.py"), not the code.
- **Explanation:** why, in one or two plain sentences ("Your phone's storage is full.").
- **Primary action:** exactly one, a verb: Retry, Open settings, Grant, Install, Free space,
  Reload, Update credentials.
- No exception names, no stack traces, no paths outside the workspace / shared-storage roots,
  no blame ("You did…").
- Same code → same wording everywhere.

### Copy details

Copied as plain text, always redacted:

```
LeoCode error E_IO (corr c-7f3a2e)
Action: fs.write · 2026-11-11 14:02:11
App 0.1.0 (12) · Android 15 (API 35) · WebView 137 · arm64-v8a · root: enabled
Summary: write failed: no space left on device
```

Excludes tokens, keys, passphrases, environment values, URL credentials and outside paths
(replaced by `<outside>`).

### Recovery after a crash

- Renderer loss: WebView is recreated silently, then the banner "Restored after a problem" with
  **Details**. Two losses within a minute → RecoveryActivity.
- On the next launch after a host crash: RecoveryActivity first, then the workspace with the
  "Restore unsaved changes (N files)" prompt (drafts, Task 15).
- Share diagnostics uses the Android share sheet; nothing is sent automatically (D-013).

## Accessibility and performance

- 48 dp minimum touch targets, all icons have `contentDescription`, font scaling up to 200 %.
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI.
- Budgets: cold start < 2.5 s, keystroke-to-glyph < 50 ms, editor RSS < 120 MB, terminal scroll < 16 ms/frame
  on the Redmi Note 7S.
