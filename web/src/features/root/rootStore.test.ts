import { describe, it, expect, vi } from "vitest"
import { createRootStore } from "./rootStore"
import type { Bridge, RootStatus, RootRequestResult, RootLostEvent } from "../../bridge/types"

function createMockBridge(overrides: Partial<Bridge> = {}): Bridge {
  const rootAvailable = true
  let rootGranted = false
  let rootEnabled = false

  return {
    mode: "mock",
    rootStatus: vi.fn(async (): Promise<RootStatus> => ({
      available: rootAvailable,
      granted: rootGranted,
      enabled: rootEnabled
    })),
    rootRequest: vi.fn(async (): Promise<RootRequestResult> => {
      rootGranted = true
      rootEnabled = true
      return { granted: true }
    }),
    onRootLost: vi.fn((_listener: (event: RootLostEvent) => void) => {
      return () => {}
    }),
    ...overrides
  } as unknown as Bridge
}

describe("rootStore", () => {
  it("initializes with default values", () => {
    const bridge = createMockBridge()
    const store = createRootStore(bridge)
    const state = store.getState()

    expect(state.available).toBe(false)
    expect(state.granted).toBe(false)
    expect(state.enabled).toBe(false)
    expect(state.loading).toBe(false)
    expect(state.warningOpen).toBe(false)
  })

  it("checks root status from bridge", async () => {
    const bridge = createMockBridge()
    const store = createRootStore(bridge)

    await store.getState().checkStatus()
    const state = store.getState()

    expect(bridge.rootStatus).toHaveBeenCalled()
    expect(state.available).toBe(true)
    expect(state.granted).toBe(false)
    expect(state.enabled).toBe(false)
    expect(state.loading).toBe(false)
  })

  it("requests root grant successfully", async () => {
    const bridge = createMockBridge()
    const store = createRootStore(bridge)

    const granted = await store.getState().requestRoot()
    expect(granted).toBe(true)
    expect(bridge.rootRequest).toHaveBeenCalled()

    const state = store.getState()
    expect(state.granted).toBe(true)
    expect(state.enabled).toBe(true)
    expect(state.loading).toBe(false)
  })

  it("handles request failure gracefully", async () => {
    const bridge = createMockBridge({
      rootRequest: vi.fn(async () => {
        throw new Error("Root denied")
      })
    })
    const store = createRootStore(bridge)

    await expect(store.getState().requestRoot()).rejects.toThrow("Root denied")
    const state = store.getState()
    expect(state.granted).toBe(false)
    expect(state.enabled).toBe(false)
    expect(state.loading).toBe(false)
  })

  it("disables root mode", async () => {
    const bridge = createMockBridge()
    const store = createRootStore(bridge)

    await store.getState().requestRoot()
    expect(store.getState().enabled).toBe(true)

    store.getState().disableRoot()
    expect(store.getState().enabled).toBe(false)
  })

  it("handles onRootLost event", () => {
    let capturedListener: ((event: RootLostEvent) => void) | undefined
    const bridge = createMockBridge({
      onRootLost: (listener) => {
        capturedListener = listener
        return () => {}
      }
    })

    const store = createRootStore(bridge)
    store.setState({ granted: true, enabled: true })

    expect(store.getState().enabled).toBe(true)

    // Trigger root lost event
    expect(capturedListener).toBeDefined()
    capturedListener!({ sessionId: "test-123" })

    expect(store.getState().granted).toBe(false)
    expect(store.getState().enabled).toBe(false)
  })
})
