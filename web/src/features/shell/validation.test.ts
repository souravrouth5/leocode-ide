import { describe, expect, it } from "vitest"
import { MAX_NAME_LENGTH, validateEntryName, validatePathInput } from "./validation"

describe("entry name validation (W-28)", () => {
  it("accepts ordinary names", () => {
    expect(validateEntryName("notes.txt")).toBeNull()
    expect(validateEntryName("  spaced.md  ")).toBeNull()
    expect(validateEntryName("é".repeat(MAX_NAME_LENGTH))).toBeNull()
  })

  it("rejects empty and whitespace-only names", () => {
    expect(validateEntryName("")).toContain("Enter a name")
    expect(validateEntryName("   ")).toContain("Enter a name")
  })

  it("rejects path separators", () => {
    expect(validateEntryName("a/b")).toContain("/")
    expect(validateEntryName("a\\b")).toContain("/")
  })

  it("rejects dot and dot-dot", () => {
    expect(validateEntryName(".")).toContain("..")
    expect(validateEntryName("..")).toContain("..")
  })

  it("rejects control characters", () => {
    expect(validateEntryName("a\u0000b")).toContain("control")
    expect(validateEntryName("a\tb")).toContain("control")
  })

  it("rejects over-long names", () => {
    expect(validateEntryName("x".repeat(MAX_NAME_LENGTH + 1))).toContain("at most")
  })
})

describe("Save As path validation (W-28)", () => {
  it("accepts names and full paths", () => {
    expect(validatePathInput("notes.md")).toBeNull()
    expect(validatePathInput("src/notes.md")).toBeNull()
    expect(validatePathInput("/storage/emulated/0/Download/x.txt")).toBeNull()
  })

  it("rejects an empty path", () => {
    expect(validatePathInput("  ")).toContain("Enter a file name")
  })

  it("rejects empty segments and traversal", () => {
    expect(validatePathInput("a//b")).toContain("valid path")
    expect(validatePathInput("a/../b")).toContain("..")
    expect(validatePathInput("/")).toContain("valid path")
  })

  it("rejects control characters", () => {
    expect(validatePathInput("a\u0007b")).toContain("control")
  })
})
