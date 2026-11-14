import { describe, expect, it, vi } from "vitest"
import { createErrorsStore } from "./errorsStore"
import { AppError } from "../bridge/types"

describe("errors store routing (Task 12)", () => {
  it("sends a missing file to the snackbar queue", () => {
    const notify = vi.fn()
    const store = createErrorsStore(notify)
    store.getState().report(new AppError("E_NOT_FOUND", "gone"))

    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Not found", detail: "gone" })
    )
    expect(store.getState().banner).toBeNull()
    expect(store.getState().sheet).toBeNull()
  })

  it("keeps a timeout in the banner with its retry", () => {
    const retry = vi.fn()
    const store = createErrorsStore(vi.fn())
    store.getState().report(new AppError("E_TIMEOUT", "slow"), { retry })

    expect(store.getState().banner?.entry.surface).toBe("banner")
    expect(store.getState().banner?.retry).toBe(retry)
    expect(store.getState().sheet).toBeNull()
  })

  it("opens a sheet for disk-full and can dismiss it", () => {
    const store = createErrorsStore(vi.fn())
    store.getState().report(new AppError("E_DISK_FULL", "no space"))

    expect(store.getState().sheet?.entry.surface).toBe("sheet")
    store.getState().dismissSheet()
    expect(store.getState().sheet).toBeNull()
  })

  it("routes unknown/plain exceptions to the internal sheet", () => {
    const store = createErrorsStore(vi.fn())
    store.getState().report(new Error("kaboom"), { context: "test" })

    expect(store.getState().sheet?.error.code).toBe("E_INTERNAL")
    expect(store.getState().sheet?.context).toBe("test")
  })
})
