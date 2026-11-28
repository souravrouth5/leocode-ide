// @ts-expect-error Node module available in Vitest test runner
import fs from "fs"
// @ts-expect-error Node module available in Vitest test runner
import path from "path"
import { describe, expect, it } from "vitest"

// @ts-expect-error __dirname injected by test runner
const currentDir: string = typeof __dirname !== "undefined" ? __dirname : "."
const stylesDir = path.resolve(currentDir, "../../styles")
const read = (name: string) => fs.readFileSync(path.join(stylesDir, name), "utf-8")

/**
 * Layout regressions found on device. These read the stylesheets directly
 * because the failures are pure CSS (class collisions and missing insets), and
 * jsdom does not compute layout.
 */
describe("app chrome layout", () => {
  it("keeps the header run button free of the Run sheet's padding", () => {
    const css = read("run.css")
    // `.icon-btn.run` and the Run sheet container once shared the `.run` class,
    // so the sheet's `padding: 0 16px` pushed the play glyph to the right edge.
    expect(css).not.toMatch(/^\.run\s*\{/m)
    expect(css).toMatch(/\.icon-btn\.run\s*\{[^}]*\bpadding:\s*0;/)
    expect(css).toMatch(/\.run-panel\s*\{[^}]*\bpadding:\s*0 16px;/)
  })

  it("keeps the sidebar header and footer clear of the system bars", () => {
    const css = read("drawer-explorer.css")
    expect(css).toMatch(/\.sidebar\s*\{[^}]*\bpadding-top:\s*var\(--inset-top\)/)
    expect(css).toMatch(/\.sidebar\s*\{[^}]*\bpadding-bottom:\s*var\(--inset-bottom\)/)
  })

  it("gives every settings tab the same height with a pinned tab strip", () => {
    const css = read("settings-dialog.css")
    expect(css).toMatch(/\.sheet\.settings-sheet\s*\{[^}]*\bheight:\s*86%/)
    expect(css).toMatch(/\.settings-nav-tabs\s*\{[^}]*\bflex:\s*0 0 auto/)
    expect(css).toMatch(/\.settings-panel\s*\{[^}]*\bflex:\s*1 1 auto/)
    expect(css).toMatch(/\.settings-panel\s*\{[^}]*\boverflow-y:\s*auto/)
  })
})
