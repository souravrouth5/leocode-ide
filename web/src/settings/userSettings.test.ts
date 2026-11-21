import { beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./userSettings"

describe("userSettings", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it("merges stored partial settings over the defaults", () => {
    localStorage.setItem(
      "leocode.user-settings",
      JSON.stringify({ fontSize: 18, appTheme: "dark" })
    )

    const settings = loadSettings()

    expect(settings.fontSize).toBe(18)
    expect(settings.appTheme).toBe("dark")
    expect(settings.sortBy).toBe(DEFAULT_SETTINGS.sortBy)
  })

  it("ignores unreadable stored settings instead of throwing", () => {
    localStorage.setItem("leocode.user-settings", "{not json")

    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it("round-trips saved settings", () => {
    const next = { ...DEFAULT_SETTINGS, fontSize: 16, terminalFontSize: 15 }

    saveSettings(next)

    expect(loadSettings()).toMatchObject({
      fontSize: 16,
      terminalFontSize: 15
    })
  })
})

describe("stored settings validation (W-34)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("falls back to defaults for wrong-typed fields", () => {
    localStorage.setItem(
      "leocode.user-settings",
      JSON.stringify({
        appTheme: "neon",
        fontSize: "big",
        tabSize: 3,
        wordWrap: "yes",
        bookmarks: "not-a-list",
        recentFiles: [1, 2, 3],
        editorTheme: "unknown-theme",
        sortBy: "random"
      })
    )

    const settings = loadSettings()

    expect(settings.appTheme).toBe(DEFAULT_SETTINGS.appTheme)
    expect(settings.fontSize).toBe(DEFAULT_SETTINGS.fontSize)
    expect(settings.tabSize).toBe(DEFAULT_SETTINGS.tabSize)
    expect(settings.wordWrap).toBe(DEFAULT_SETTINGS.wordWrap)
    expect(settings.bookmarks).toEqual(DEFAULT_SETTINGS.bookmarks)
    expect(settings.recentFiles).toEqual([])
    expect(settings.editorTheme).toBe(DEFAULT_SETTINGS.editorTheme)
    expect(settings.sortBy).toBe(DEFAULT_SETTINGS.sortBy)
  })

  it("clamps out-of-range sizes", () => {
    localStorage.setItem(
      "leocode.user-settings",
      JSON.stringify({ fontSize: 999, terminalFontSize: 1 })
    )

    expect(loadSettings().fontSize).toBe(32)
    expect(loadSettings().terminalFontSize).toBe(8)
  })

  it("drops keys that no longer exist", () => {
    localStorage.setItem(
      "leocode.user-settings",
      JSON.stringify({ openTabs: ["a.txt"], activeTab: "a.txt", fontSize: 15 })
    )

    const settings = loadSettings() as unknown as Record<string, unknown>

    expect(settings.fontSize).toBe(15)
    expect(settings).not.toHaveProperty("openTabs")
    expect(settings).not.toHaveProperty("activeTab")
  })

  it("ignores an array or a primitive stored value", () => {
    localStorage.setItem("leocode.user-settings", JSON.stringify([1, 2, 3]))
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)

    localStorage.setItem("leocode.user-settings", JSON.stringify("hello"))
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})
