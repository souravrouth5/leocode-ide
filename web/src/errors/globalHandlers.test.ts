import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createBootErrorQueue,
  installGlobalErrorHandlers,
  isBenignError
} from "./globalHandlers"

let dispose: (() => void) | null = null

afterEach(() => {
  dispose?.()
  dispose = null
})

function fireError(message: string, error?: unknown) {
  window.dispatchEvent(new ErrorEvent("error", { message, error, cancelable: true }))
}

function fireRejection(reason: unknown) {
  const event = new Event("unhandledrejection") as Event & { reason: unknown }
  event.reason = reason
  window.dispatchEvent(event)
}

describe("global error handlers (W-11)", () => {
  it("ignores the benign ResizeObserver loop error in both shapes", () => {
    const report = vi.fn()
    dispose = installGlobalErrorHandlers(report)

    fireError("ResizeObserver loop completed with undelivered notifications")
    fireError("", new Error("ResizeObserver loop completed with undelivered notifications"))
    fireError("ResizeObserver loop limit exceeded")
    expect(report).not.toHaveBeenCalled()

    fireError("real failure")
    expect(report).toHaveBeenCalledTimes(1)
  })

  it("recognises the benign message", () => {
    expect(
      isBenignError("ResizeObserver loop completed with undelivered notifications")
    ).toBe(true)
    expect(isBenignError(new Error("ResizeObserver loop limit exceeded"))).toBe(true)
    expect(isBenignError(new Error("kaboom"))).toBe(false)
    expect(isBenignError(null)).toBe(false)
  })

  it("reports an identical error once per window", () => {
    let clock = 0
    const report = vi.fn()
    dispose = installGlobalErrorHandlers(report, { dedupeMs: 1_000, now: () => clock })

    fireError("same failure")
    fireError("same failure")
    expect(report).toHaveBeenCalledTimes(1)

    clock = 1_001
    fireError("same failure")
    expect(report).toHaveBeenCalledTimes(2)
  })

  it("does not recurse when the reporter throws or re-enters", () => {
    const calls: string[] = []
    const log = vi.fn()
    dispose = installGlobalErrorHandlers(
      (error) => {
        calls.push(error instanceof Error ? error.message : String(error))
        // A reporter that raises another window error synchronously.
        window.dispatchEvent(new ErrorEvent("error", { message: "nested while reporting" }))
        throw new Error("reporter exploded")
      },
      { log }
    )

    expect(() => fireError("outer failure")).not.toThrow()
    expect(calls).toEqual(["outer failure"])
    expect(log).toHaveBeenCalled()
  })

  it("caps an error storm instead of flooding the surfaces", () => {
    const report = vi.fn()
    dispose = installGlobalErrorHandlers(report, {
      dedupeMs: 1_000,
      maxReportsPerWindow: 2,
      now: () => 0,
      log: vi.fn()
    })

    fireError("one")
    fireError("two")
    fireError("three")
    expect(report).toHaveBeenCalledTimes(2)
  })

  it("reports unhandled rejections and stops after dispose", () => {
    const report = vi.fn()
    dispose = installGlobalErrorHandlers(report)

    fireRejection(new Error("no handler"))
    expect(report).toHaveBeenCalledWith(expect.any(Error), "unhandled promise rejection")

    dispose()
    dispose = null
    fireRejection(new Error("ignored"))
    expect(report).toHaveBeenCalledTimes(1)
  })
})

describe("boot error queue (W-11)", () => {
  it("keeps errors seen before the stores exist and reports them once", () => {
    const queue = createBootErrorQueue(3)
    queue.capture(new Error("early"), "window error")
    queue.capture(new Error("later"))
    expect(queue.size).toBe(2)

    const report = vi.fn()
    expect(queue.flush(report)).toBe(2)
    expect(report).toHaveBeenNthCalledWith(1, expect.any(Error), "window error")
    expect(report).toHaveBeenNthCalledWith(2, expect.any(Error), "startup")
    expect(queue.size).toBe(0)

    // A second mount must not replay them.
    expect(queue.flush(report)).toBe(0)
    expect(report).toHaveBeenCalledTimes(2)
  })

  it("keeps only the latest errors when boot keeps failing", () => {
    const queue = createBootErrorQueue(2)
    queue.capture(new Error("a"))
    queue.capture(new Error("b"))
    queue.capture(new Error("c"))

    const report = vi.fn()
    queue.flush(report)
    expect(report).toHaveBeenCalledTimes(2)
    expect((report.mock.calls[0][0] as Error).message).toBe("b")
    expect((report.mock.calls[1][0] as Error).message).toBe("c")
  })
})
