import { describe, expect, it } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"
import { AppError, type UpdateCheck, type UpdateInstallRequest } from "../../bridge"

const available = (overrides: Partial<UpdateCheck> = {}): UpdateCheck => ({
  available: true,
  currentVersion: "0.1.0-rc1",
  versionName: "0.1.0-rc2",
  versionCode: 102,
  notes: "Self-update demo",
  url: "https://example.invalid/leocode-102.apk",
  sha256: "a".repeat(64),
  size: 12_000_000,
  ...overrides
})

describe("update store (Task 28)", () => {
  it("reports the mock build as current", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.updates.getState().checkForUpdate()

    expect(stores.updates.getState().status).toBe("current")
    expect(stores.updates.getState().check?.currentVersion).toBe("0.0.1-mock")
    expect(stores.updates.getState().checkedAt).not.toBeNull()
  })

  it("shows a verified newer release without installing it", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => available()
    const stores = createAppStores(bridge)

    await stores.updates.getState().checkForUpdate()

    expect(stores.updates.getState().status).toBe("available")
    expect(stores.updates.getState().check?.versionCode).toBe(102)
    expect(stores.updates.getState().progress).toBeNull()
  })

  it("passes the exact manifest fields and streams progress", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => available()
    let request: UpdateInstallRequest | null = null
    bridge.installUpdate = async (next, onProgress, onStart) => {
      request = next
      onStart?.({ cancel: () => {} })
      onProgress({ phase: "download", bytes: 500, total: 1000 })
      onProgress({ phase: "verify", bytes: 1000, total: 1000 })
      onProgress({ phase: "install", bytes: 1000, total: 1000 })
    }
    const stores = createAppStores(bridge)

    await stores.updates.getState().checkForUpdate()
    await stores.updates.getState().install()

    expect(request).toEqual({
      url: "https://example.invalid/leocode-102.apk",
      sha256: "a".repeat(64),
      size: 12_000_000,
      versionCode: 102
    })
    expect(stores.updates.getState().status).toBe("installer")
    expect(stores.updates.getState().progress?.phase).toBe("install")
  })

  it("treats a cancel as a user decision, not an error", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => available()
    let cancel: (() => void) | null = null
    let rejectJob: ((error: unknown) => void) | null = null
    bridge.installUpdate = (_request, _onProgress, onStart) =>
      new Promise<void>((_resolve, reject) => {
        rejectJob = reject
        onStart?.({
          cancel: () => {
            cancel = () => reject(new AppError("E_CANCELLED", "update cancelled"))
            cancel()
          }
        })
      })
    const stores = createAppStores(bridge)

    await stores.updates.getState().checkForUpdate()
    const job = stores.updates.getState().install()
    stores.updates.getState().cancel()
    await job

    expect(cancel).not.toBeNull()
    expect(rejectJob).not.toBeNull()
    expect(stores.updates.getState().status).toBe("available")
    expect(stores.updates.getState().error).toBeNull()
    expect(stores.errors.getState().recent).toHaveLength(0)
  })

  it("surfaces an integrity failure once and keeps the manifest", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => available()
    bridge.installUpdate = async () => {
      throw new AppError("E_INTEGRITY", "the update failed its integrity check")
    }
    const stores = createAppStores(bridge)

    await stores.updates.getState().checkForUpdate()
    await stores.updates.getState().install()

    expect(stores.updates.getState().status).toBe("error")
    expect(stores.updates.getState().error?.code).toBe("E_INTEGRITY")
    expect(stores.updates.getState().check?.versionCode).toBe(102)
    expect(stores.errors.getState().recent).toHaveLength(1)
  })

  it("rejects a manifest the host could not verify", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => {
      throw new AppError("E_BAD_MANIFEST", "the update manifest signature is missing")
    }
    const stores = createAppStores(bridge)

    await stores.updates.getState().checkForUpdate()

    expect(stores.updates.getState().status).toBe("error")
    expect(stores.updates.getState().error?.code).toBe("E_BAD_MANIFEST")
    expect(stores.updates.getState().check).toBeNull()
  })

  it("does not install when the manifest is incomplete", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => available({ url: null })
    let called = false
    bridge.installUpdate = async () => {
      called = true
    }
    const stores = createAppStores(bridge)

    await stores.updates.getState().checkForUpdate()
    await stores.updates.getState().install()

    expect(called).toBe(false)
    expect(stores.updates.getState().status).toBe("error")
    expect(stores.updates.getState().error?.code).toBe("E_BAD_MANIFEST")
  })
})
