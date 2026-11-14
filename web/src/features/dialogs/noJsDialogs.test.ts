import { describe, expect, it } from "vitest"

/**
 * Guard against reintroducing native JS dialogs (PD-02).
 *
 * Android's WebView cancels unhandled `confirm`/`prompt` dialogs, so
 * `window.confirm` always returns false and `window.prompt` always returns null
 * on device. Every user-facing confirmation or text prompt must go through
 * `features/dialogs/dialogStore.ts` instead.
 *
 * Sources are loaded through Vite's raw glob so the test needs no Node typings
 * and works in the same transform pipeline as the rest of the suite.
 */
const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>

/** The dialog implementation itself is the only place allowed to mention them. */
const DIALOGS_DIRECTORY = "/src/features/dialogs/"

describe("no native JS dialogs in production code (PD-02)", () => {
  it("only the in-app dialog implementation refers to window.confirm/window.prompt", () => {
    // If the glob ever stops matching, the check must fail loudly instead of
    // passing on an empty file list.
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    const offenders = Object.keys(sources)
      .filter((path) => !/\.test\.(ts|tsx)$/.test(path))
      .filter((path) => !path.startsWith(DIALOGS_DIRECTORY))
      .filter((path) => /window\.(confirm|prompt)\s*\(/.test(sources[path]))
      .sort()

    expect(offenders).toEqual([])
  })
})
