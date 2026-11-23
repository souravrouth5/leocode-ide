import { describe, expect, it } from "vitest"
import { AppError, type UpdateCheck } from "../../bridge"
import { describeUpdateStatus, formatBytes } from "./updateCopy"

const check = (overrides: Partial<UpdateCheck> = {}): UpdateCheck => ({
  available: true,
  currentVersion: "0.1.0-rc1",
  versionName: "0.1.0-rc2",
  versionCode: 102,
  notes: null,
  url: null,
  sha256: null,
  size: null,
  ...overrides
})

describe("update copy (Task 28)", () => {
  it("names the current version when there is nothing newer", () => {
    expect(describeUpdateStatus("current", check({ available: false }), null)).toContain("0.1.0-rc1")
  })

  it("names the available version", () => {
    expect(describeUpdateStatus("available", check(), null)).toContain("0.1.0-rc2")
  })

  it("shows the safe error message instead of a raw failure", () => {
    const error = new AppError("E_INTEGRITY", "the update failed its integrity check")
    expect(describeUpdateStatus("error", check(), error)).toBe(
      "the update failed its integrity check"
    )
  })

  it("formats sizes for the download row", () => {
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(12_000_000)).toBe("11.4 MB")
  })
})
