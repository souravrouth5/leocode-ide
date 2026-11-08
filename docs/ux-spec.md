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

## Onboarding (3 screens, skippable)

1. **How files work** — projects live inside LeoCode; import/export via the system picker; uninstall
   deletes them (export first).
2. **Battery** — MIUI/Android 12+: set battery to "No restrictions", enable autostart. Buttons deep-link
   where Android allows.
3. **Trust model** — code you run has the same access as LeoCode itself. Only run projects you trust.
   This is the D-008 warning and cannot be skipped silently.

## Accessibility and performance

- 48 dp minimum touch targets, all icons have `contentDescription`, font scaling up to 200 %.
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI.
- Budgets: cold start < 2.5 s, keystroke-to-glyph < 50 ms, editor RSS < 120 MB, terminal scroll < 16 ms/frame
  on the Redmi Note 7S.

## Error surfaces

- Inline, actionable, never a raw stack trace: what failed, why, and one primary action
  (Retry / Open settings / Copy details).
- Clipboard copy of diagnostics excludes secrets and paths outside the workspace.
