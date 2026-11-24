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
    rootDisable: vi.fn(async (): Promise<RootStatus> => {
      rootGranted = false
      rootEnabled = false
      return {
        available: rootAvailable,
        granted: false,
        enabled: false
      }
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
    expect(state.lastLost).toBeNull()
    expect(state.liveRootCount).toBe(0)
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

  it("requests root grant successfully and triggers checkStatus", async () => {
    const bridge = createMockBridge()
    const store = createRootStore(bridge)

    const granted = await store.getState().requestRoot()
    expect(granted).toBe(true)
    expect(bridge.rootRequest).toHaveBeenCalled()
    expect(bridge.rootStatus).toHaveBeenCalled()

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

  it("disables root mode calling bridge.rootDisable and applies reply", async () => {
    const bridge = createMockBridge()
    const store = createRootStore(bridge)

    await store.getState().requestRoot()
    expect(store.getState().enabled).toBe(true)

    await store.getState().disableRoot()
    expect(bridge.rootDisable).toHaveBeenCalledTimes(1)
    expect(store.getState().enabled).toBe(false)
    expect(store.getState().granted).toBe(false)
    expect(store.getState().loading).toBe(false)
  })

  it("keeps old state and rethrows when disableRoot rejects", async () => {
    const bridge = createMockBridge({
      rootDisable: vi.fn(async () => {
        throw new Error("Bridge failure")
      })
    })
    const store = createRootStore(bridge)
    store.setState({ enabled: true, granted: true, available: true })

    await expect(store.getState().disableRoot()).rejects.toThrow("Bridge failure")
    expect(store.getState().enabled).toBe(true)
    expect(store.getState().granted).toBe(true)
    expect(store.getState().loading).toBe(false)
  })

  it("keeps enabled, clears granted, and sets lastLost on root.lost event", () => {
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

    const before = Date.now()
    capturedListener!({ sessionId: "test-123", reason: "denied" })

    expect(store.getState().granted).toBe(false)
    expect(store.getState().enabled).toBe(true)
    expect(store.getState().lastLost).not.toBeNull()
    expect(store.getState().lastLost?.reason).toBe("denied")
    expect(store.getState().lastLost?.at).toBeGreaterThanOrEqual(before)
  })

  it("tracks liveRootCount with rootProcessStarted and rootProcessEnded", () => {
    const bridge = createMockBridge()
    const store = createRootStore(bridge)

    expect(store.getState().liveRootCount).toBe(0)
    store.getState().rootProcessStarted()
    expect(store.getState().liveRootCount).toBe(1)
    store.getState().rootProcessStarted()
    expect(store.getState().liveRootCount).toBe(2)
    store.getState().rootProcessEnded()
    expect(store.getState().liveRootCount).toBe(1)
    store.getState().rootProcessEnded()
    expect(store.getState().liveRootCount).toBe(0)
    store.getState().rootProcessEnded()
    expect(store.getState().liveRootCount).toBe(0)
  })

  it("clears lastLost when requestRoot succeeds and when disableRoot succeeds", async () => {
    const bridge = createMockBridge()
    const store = createRootStore(bridge)

    // Simulate prior loss
    store.setState({ lastLost: { reason: "denied", at: Date.now() }, enabled: true, granted: false })
    expect(store.getState().lastLost).not.toBeNull()

    // Successful requestRoot resets lastLost to null
    await store.getState().requestRoot()
    expect(store.getState().lastLost).toBeNull()

    // Simulate another loss
    store.setState({ lastLost: { reason: "revoked", at: Date.now() } })
    expect(store.getState().lastLost).not.toBeNull()

    // Successful disableRoot resets lastLost to null
    await store.getState().disableRoot()
    expect(store.getState().lastLost).toBeNull()
  })
})
