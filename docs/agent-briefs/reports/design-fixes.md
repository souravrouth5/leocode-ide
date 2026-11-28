# UI design fixes — cropped drawer, Run button, Settings height

- **Date:** 2026-11-28
- **Devices:** D1 (`11f98015`, Redmi Note 7S, Android 9 / SDK 28, 1080x2340) and
  D2 (`10.8.0.52:40061`, POCO F1, Android 15, 1080x2246)
- **Build:** `dist/release/leocode-1014.apk` (`0.1.0-rc14`, `versionCode=1014`),
  sha256 `3f57a5a284c98fb54f025251f967841d610ed5663507b3ac93faea866d86d6d2`,
  18 942 499 bytes
- **Branch:** `feat/phase-g`
- **Raw log:** [`docs/device-reports/20261128-design-D1-11f98015.txt`](../../device-reports/20261128-design-D1-11f98015.txt)

Three device-reported design issues were fixed in the web shell. All three are
CSS-only except for two class-name changes, and each has a static regression
test in `web/src/features/layout/chromeLayout.test.ts`.

## 1. Sidebar drawer cropped by the system bars

**Cause:** `.sidebar` is `position: fixed; top: 0; bottom: 0`, so it covered the
status and navigation bars. The drawer header rendered under the status bar and
the footer was clipped at the bottom edge (most visible on D2).

**Fix:** `web/src/styles/drawer-explorer.css` gives the drawer
`padding-top: var(--inset-top)` and `padding-bottom: var(--inset-bottom)`.
The tokens already come from `env(safe-area-inset-*)` in `tokens.css`.

**Evidence:** the header ("LeoCode IDE") is below the status bar and the
Settings / Terminal / Runtimes footer is fully visible above the navigation bar
on both devices.

## 2. Green Run button drew the play glyph at its right edge

**Cause:** a class collision. The Run sheet container used `.run`, and
`run.css` applied `padding: 0 16px` to `.run`. The header button is
`icon-btn run`, so it inherited 16px of left padding and the 15px glyph was
pushed to the right edge. The collision existed since the sheet was introduced
(`8e9bed6`).

**Fix:** the sheet container is now `.run-panel` (`run.css`, `RunSheet.tsx`),
and `.icon-btn.run` sets `padding: 0` explicitly.

**Evidence:** measured against the shipped CSS in headless Firefox, the button
box centre and the SVG centre are both x = 1016.0 and computed padding is
`0px`. On device the triangle is centred on D1 and D2, and the Run sheet still
lays out with its 16px horizontal padding.

## 3. Settings tabs changed height and scrolled away

**Cause:** the sheet had only `max-height: 86%`, so each tab's content set the
sheet height, and the whole `.sheet-body` scrolled — taking the tab strip with
it.

**Fix:** `SettingsDialog` passes `className="settings-sheet"`;
`settings-dialog.css` sets a fixed `height: 86%`, makes `.sheet-body` a
non-scrolling flex column, pins `.settings-nav-tabs` (`flex: 0 0 auto`) and
scrolls only `.settings-panel` (`flex: 1 1 auto; min-height: 0;
overflow-y: auto`). `.settings-card` is `flex: 0 0 auto` so cards cannot be
squashed.

**Evidence:** in headless Firefox the sheet is `774px` tall and the tab strip
stays at `top=173.8 h=46.0` with both 668px and 3074px of panel content. On
device, all five tabs (Editor, Appearance, Git, About, Advanced) open at the
same sheet top and tab position; swiping in About moves only the panel.

## Gates

- `npm run typecheck` — clean
- `npm run lint` — clean
- Full web suite — 63 files / 504 tests pass, including the new
  `chromeLayout.test.ts` (3 tests)
- `./scripts/sync-web.sh` — bundle re-synced into
  `android/app/src/main/assets/web`
- Device: rc14 installed on D1 and D2; logcat shows no LeoCode errors or
  crashes.

## Screenshots

| Shot | File |
|---|---|
| D1 Run button | [`20261128-design-D1-run-btn.png`](../../device-reports/20261128-design-D1-run-btn.png) |
| D1 drawer | [`20261128-design-D1-drawer.png`](../../device-reports/20261128-design-D1-drawer.png) |
| D1 Settings, Editor | [`20261128-design-D1-settings-editor.png`](../../device-reports/20261128-design-D1-settings-editor.png) |
| D1 Settings, Advanced (short tab) | [`20261128-design-D1-settings-advanced.png`](../../device-reports/20261128-design-D1-settings-advanced.png) |
| D1 Settings, About scrolled | [`20261128-design-D1-settings-scrolled.png`](../../device-reports/20261128-design-D1-settings-scrolled.png) |
| D1 Run sheet | [`20261128-design-D1-runsheet.png`](../../device-reports/20261128-design-D1-runsheet.png) |
| D2 Run button | [`20261128-design-D2-run-btn.png`](../../device-reports/20261128-design-D2-run-btn.png) |
| D2 drawer | [`20261128-design-D2-drawer.png`](../../device-reports/20261128-design-D2-drawer.png) |
| D2 Settings, Advanced | [`20261128-design-D2-settings-advanced.png`](../../device-reports/20261128-design-D2-settings-advanced.png) |
| D2 Settings, About scrolled | [`20261128-design-D2-settings-scrolled.png`](../../device-reports/20261128-design-D2-settings-scrolled.png) |
