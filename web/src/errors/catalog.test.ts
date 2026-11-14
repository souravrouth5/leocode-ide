import { describe, expect, it } from "vitest"
import { ERROR_CODES } from "../bridge/types.gen"
import { ERROR_CATALOG, errorDetails, toAppError } from "./catalog"
import { AppError } from "../bridge/types"

describe("error catalog (Task 12)", () => {
  it("has exactly one entry per generated error code", () => {
    expect(Object.keys(ERROR_CATALOG).sort()).toEqual([...ERROR_CODES].sort())
  })

  it("gives every code a title, explanation and action", () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code]
      expect(entry.title.length, code).toBeGreaterThan(3)
      expect(entry.explanation.length, code).toBeGreaterThan(10)
      expect(entry.action.label.length, code).toBeGreaterThan(2)
      expect(["snackbar", "banner", "sheet"]).toContain(entry.surface)
    }
  })

  it("keeps the contract's surface choices", () => {
    expect(ERROR_CATALOG.E_TIMEOUT.surface).toBe("banner")
    expect(ERROR_CATALOG.E_TIMEOUT.action.kind).toBe("retry")
    expect(ERROR_CATALOG.E_DISK_FULL.surface).toBe("sheet")
    expect(ERROR_CATALOG.E_NOT_FOUND.surface).toBe("snackbar")
    expect(ERROR_CATALOG.E_BRIDGE_DISCONNECTED.action.kind).toBe("reload")
  })

  it("wraps unknown errors as E_INTERNAL", () => {
    const wrapped = toAppError(new Error("boom"))
    expect(wrapped.code).toBe("E_INTERNAL")
    expect(wrapped.message).toBe("boom")
    expect(toAppError("nope").code).toBe("E_INTERNAL")
  })

  it("builds redacted details without a stack", () => {
    const error = new AppError("E_IO", "write failed")
    const details = errorDetails(error, "Save file")
    expect(details).toContain("E_IO")
    expect(details).toContain("During: Save file")
    expect(details).not.toContain("at ")
  })
})
