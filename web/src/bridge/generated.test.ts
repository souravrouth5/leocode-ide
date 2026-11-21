import { describe, expect, it } from "vitest"
import { ERROR_CODES, isErrorCode } from "./types.gen"

describe("generated bridge contract", () => {
  it("lists every error code once", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
    expect(ERROR_CODES).toContain("E_INTERNAL")
    expect(ERROR_CODES).toContain("E_ROOT_DENIED")
  })

  it("accepts only generated codes", () => {
    expect(isErrorCode("E_PATH_OUTSIDE_ROOT")).toBe(true)
    expect(isErrorCode("E_NOT_A_CODE")).toBe(false)
    expect(isErrorCode(undefined)).toBe(false)
    expect(isErrorCode(42)).toBe(false)
  })
})
