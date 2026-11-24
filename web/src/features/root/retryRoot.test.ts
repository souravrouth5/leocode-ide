import { describe, it, expect, vi } from "vitest"
import { createStore } from "zustand/vanilla"
import { retryRoot } from "./retryRoot"
import type { RootState } from "./rootStore"
import type { ErrorsState } from "../../errors/errorsStore"

describe("retryRoot", () => {
  it("returns true on successful root request and reports no error", async () => {
    const requestRoot = vi.fn(async () => true)
    const report = vi.fn()

    const rootStore = createStore<RootState>(() => ({
      requestRoot
    } as unknown as RootState))

    const errorsStore = createStore<ErrorsState>(() => ({
      report
    } as unknown as ErrorsState))

    const result = await retryRoot({ root: rootStore, errors: errorsStore })

    expect(result).toBe(true)
    expect(requestRoot).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
  })

  it("returns false when requestRoot returns false without throwing", async () => {
    const requestRoot = vi.fn(async () => false)
    const report = vi.fn()

    const rootStore = createStore<RootState>(() => ({
      requestRoot
    } as unknown as RootState))

    const errorsStore = createStore<ErrorsState>(() => ({
      report
    } as unknown as ErrorsState))

    const result = await retryRoot({ root: rootStore, errors: errorsStore })

    expect(result).toBe(false)
    expect(requestRoot).toHaveBeenCalledTimes(1)
    expect(report).not.toHaveBeenCalled()
  })

  it("catches rejection, reports with context 'Request root', provides retry callback, and does not leak unhandledrejection", async () => {
    let unhandledCount = 0
    const onUnhandled = () => {
      unhandledCount++
    }
    window.addEventListener("unhandledrejection", onUnhandled)

    try {
      const error = new Error("Root permission denied by user")
      const requestRoot = vi.fn().mockRejectedValueOnce(error)
      const report = vi.fn()

      const rootStore = createStore<RootState>(() => ({
        requestRoot
      } as unknown as RootState))

      const errorsStore = createStore<ErrorsState>(() => ({
        report
      } as unknown as ErrorsState))

      const result = await retryRoot({ root: rootStore, errors: errorsStore })

      expect(result).toBe(false)
      expect(unhandledCount).toBe(0)
      expect(report).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenCalledWith(error, {
        context: "Request root",
        retry: expect.any(Function)
      })

      // Now verify the retry callback safely re-attempts and handles subsequent outcome
      const retryCallback = report.mock.calls[0][1].retry
      requestRoot.mockResolvedValueOnce(true)

      // Invoking retry callback does not throw
      retryCallback()
      // Give async tick for promise inside retry callback
      await new Promise((r) => setTimeout(r, 10))

      expect(requestRoot).toHaveBeenCalledTimes(2)
      expect(unhandledCount).toBe(0)
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandled)
    }
  })

  it("retry callback safely reports again if second attempt also throws", async () => {
    let unhandledCount = 0
    const onUnhandled = () => {
      unhandledCount++
    }
    window.addEventListener("unhandledrejection", onUnhandled)

    try {
      const err1 = new Error("First failure")
      const err2 = new Error("Second failure")
      const requestRoot = vi.fn()
        .mockRejectedValueOnce(err1)
        .mockRejectedValueOnce(err2)
      const report = vi.fn()

      const rootStore = createStore<RootState>(() => ({
        requestRoot
      } as unknown as RootState))

      const errorsStore = createStore<ErrorsState>(() => ({
        report
      } as unknown as ErrorsState))

      await retryRoot({ root: rootStore, errors: errorsStore })

      expect(report).toHaveBeenCalledTimes(1)
      expect(report).toHaveBeenLastCalledWith(err1, {
        context: "Request root",
        retry: expect.any(Function)
      })

      const retryCallback = report.mock.calls[0][1].retry
      retryCallback()
      await new Promise((r) => setTimeout(r, 10))

      expect(report).toHaveBeenCalledTimes(2)
      expect(report).toHaveBeenLastCalledWith(err2, {
        context: "Request root",
        retry: expect.any(Function)
      })
      expect(unhandledCount).toBe(0)
    } finally {
      window.removeEventListener("unhandledrejection", onUnhandled)
    }
  })
})
