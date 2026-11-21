import { describe, expect, it, vi } from "vitest"
import { createBackgroundErrorReporter } from "./background"

const TERMINAL = "Terminal input is not reaching the shell"

describe("background (fire-and-forget) error reporting (W-23)", () => {
  it("reports the first failure of a burst and counts the rest", () => {
    let clock = 0
    const report = vi.fn()
    const reporter = createBackgroundErrorReporter(report, { now: () => clock })

    reporter(new Error("write failed"), TERMINAL)
    reporter(new Error("write failed"), TERMINAL)
    reporter(new Error("write failed"), TERMINAL)

    expect(report).toHaveBeenCalledTimes(1)
    expect(reporter.suppressed(TERMINAL)).toBe(2)

    clock = 5_001
    reporter(new Error("still failing"), TERMINAL)
    expect(report).toHaveBeenCalledTimes(2)
  })

  it("keeps contexts independent", () => {
    const report = vi.fn()
    const reporter = createBackgroundErrorReporter(report, { now: () => 0 })

    reporter(new Error("a"), TERMINAL)
    reporter(new Error("b"), "The color theme was not saved to the app")
    reporter(new Error("c"), TERMINAL)

    expect(report).toHaveBeenCalledTimes(2)
    expect(report.mock.calls.map((call) => call[1])).toEqual([
      TERMINAL,
      "The color theme was not saved to the app"
    ])
  })

  it("never throws out of the caller when the reporter fails", () => {
    const reporter = createBackgroundErrorReporter(
      () => {
        throw new Error("surface exploded")
      },
      { now: () => 0 }
    )
    expect(() => reporter(new Error("write failed"), TERMINAL)).not.toThrow()
  })
})
