import { describe, expect, it } from "vitest"
import { ERROR_CODES } from "../bridge/types.gen"
import { ERROR_CATALOG, errorDetails, nextCorrelationId, toAppError } from "./catalog"
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

  it("builds details without a stack and with version and correlation id", () => {
    const error = new AppError("E_IO", "write failed")
    const details = errorDetails(error, "Save file", {
      version: "0.1.0",
      correlationId: "lc-test-1",
      when: new Date("2026-01-02T03:04:05.000Z")
    })
    expect(details).toContain("LeoCode error: E_IO")
    expect(details).toContain("During: Save file")
    expect(details).toContain("When: 2026-01-02T03:04:05.000Z")
    expect(details).toContain("Version: 0.1.0")
    expect(details).toContain("Correlation: lc-test-1")
    expect(details).not.toContain("    at ")
  })

  it("redacts hostile content in Copy details (W-09)", () => {
    const hostile = [
      "auth rejected: Authorization: Bearer abcdefghijklmnopqrstuvwxyz",
      "clone https://user:hunter2@git.example.com/org/repo.git",
      'config {"token": "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"}',
      "GITHUB_TOKEN=ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
      "DB_PASSWORD=hunter2",
      "spilled /data/user/0/dev.leocode/files/home/key.txt and /storage/emulated/0/Download/x"
    ].join("\n")
    const error = new AppError("E_AUTH", hostile)
    const details = errorDetails(error, "Push /storage/emulated/0/Download/repo", {
      version: "0.1.0",
      correlationId: "lc-test-2"
    })

    // Structure survives for debugging…
    expect(details).toContain("LeoCode error: E_AUTH")
    expect(details).toContain("Surface: sheet")
    expect(details).toContain("Correlation: lc-test-2")
    expect(details).toContain("<redacted>")

    // …and no secret or absolute path does.
    for (const secret of [
      "abcdefghijklmnopqrstuvwxyz",
      "hunter2",
      "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
      "/data/user/0",
      "/storage/emulated/0"
    ]) {
      expect(details, secret).not.toContain(secret)
    }
  })

  it("gives every report a distinct correlation id", () => {
    const first = nextCorrelationId(1_700_000_000_000)
    const second = nextCorrelationId(1_700_000_000_000)
    expect(first).not.toBe(second)
    expect(first.startsWith("lc-")).toBe(true)
  })
})
