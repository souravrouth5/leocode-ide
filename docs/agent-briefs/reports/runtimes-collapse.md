# Runtimes — collapsible "This project's Python" panel

- **Date:** 2026-11-28
- **Device:** D2 (`e76846f`, POCO F1, Android 15 / SDK 35, 1080x2246). D1 was
  offline for this run.
- **Build:** `dist/release/leocode-1015.apk` (`0.1.0-rc15`, `versionCode=1015`),
  sha256 `671285c8a266ebfa0f4bc8cf98c7436619debe862556b016dc1dc878cfa2fca3`,
  18 942 912 bytes
- **Raw log:** [`docs/device-reports/20261128-runtimes-collapse-D2-e76846f.txt`](../../device-reports/20261128-runtimes-collapse-D2-e76846f.txt)

## Problem

The Runtimes view opened with the project's Python panel expanded at the top.
At 311px tall it pushed the "Runtime Environments" heading and the runtime
cards below the fold on a phone, so the list was hard to reach.

## Change

- `PythonProjectPanel` now renders a header row with a 34px chevron button.
  The button has `aria-expanded` and `aria-controls` and an explicit
  `aria-label` ("Collapse/Expand This project's Python").
- The description, status rows, action buttons, pip error and pip log live in
  `#python-project-body`, which is `hidden` while collapsed.
- While collapsed the header shows a one-line summary:
  `runtime ready · .venv ready` (or `runtime missing` / `no .venv`).
- The choice is stored under `leocode.pythonProjectCollapsed`; a fresh install
  defaults to expanded.
- The new CSS lives in `web/src/styles/runtimes.css`
  (`.python-project-head`, `.python-project-title-group`,
  `.python-project-summary`, `.python-project-toggle`).

## Result

Headless Firefox against the shipped bundle CSS:

| State | Panel height |
|---|---|
| Expanded | 311.2px |
| Collapsed | 68.0px |

The collapse frees **243.2px** of vertical space, moving the Runtime
Environments section and its cards up by the same amount.

On D2: expanded on a fresh install, collapsed to the summary row on one tap,
and still collapsed after a force-stop and relaunch.

## Tests

- New test in `CompatibilityView.test.tsx`: collapses the panel (action buttons
  become inaccessible), checks the persisted key is `"true"`, expands again and
  checks it returns to `"false"`.
- `npm run typecheck`, `npm run lint` clean.
- Full web suite: 64 files / 508 tests pass.

## Screenshots

| State | File |
|---|---|
| Expanded (default) | [`20261128-runtimes-collapse-D2-expanded.png`](../../device-reports/20261128-runtimes-collapse-D2-expanded.png) |
| Collapsed | [`20261128-runtimes-collapse-D2-collapsed.png`](../../device-reports/20261128-runtimes-collapse-D2-collapsed.png) |
| Still collapsed after relaunch | [`20261128-runtimes-collapse-D2-persisted.png`](../../device-reports/20261128-runtimes-collapse-D2-persisted.png) |
