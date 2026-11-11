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
