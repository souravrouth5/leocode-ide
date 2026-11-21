import { describe, expect, it } from "vitest"
import { MockBridge } from "../../bridge/mock"
import { AppError } from "../../bridge/types"
import { createAppStores } from "../../app/stores"

const flush = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("files store (Task 13)", () => {
  it("loads the root and navigates into a directory", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.files.getState().refresh()

    const root = stores.files.getState().entries.map((entry) => entry.name)
    expect(root).toContain("README.md")
    expect(root).toContain("main.py")

    stores.files.getState().navigate("src")
    await flush()
    expect(stores.files.getState().cwd).toBe("src")
    expect(stores.files.getState().entries.map((entry) => entry.name)).toEqual(["app.py"])
  })

  it("reports a list failure through the error store", async () => {
    const bridge = new MockBridge()
    bridge.list = async () => {
      throw new Error("boom")
    }
    const stores = createAppStores(bridge)

    await stores.files.getState().refresh()
    expect(stores.errors.getState().sheet?.error.message).toBe("boom")
    expect(stores.files.getState().loading).toBe(false)
  })
})

describe("files store request token (W-15)", () => {
  const entry = (name: string, path: string) => ({
    name,
    path,
    kind: "file" as const,
    size: 1,
    mtime: 0
  })

  it("keeps the newest list when an older request finishes last", async () => {
    const bridge = new MockBridge()
    const original = bridge.list.bind(bridge)
    bridge.list = async (path) => {
      if (path === "a") {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return [entry("a.txt", "a/a.txt")]
      }
      if (path === "b") {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return [entry("b.txt", "b/b.txt")]
      }
      return original(path)
    }
    const stores = createAppStores(bridge)

    stores.files.getState().navigate("a")
    stores.files.getState().navigate("b")
    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(stores.files.getState().cwd).toBe("b")
    expect(stores.files.getState().entries.map((item) => item.name)).toEqual(["b.txt"])
    expect(stores.files.getState().loading).toBe(false)
  })

  it("does not commit cwd when the folder cannot be listed", async () => {
    const bridge = new MockBridge()
    const original = bridge.list.bind(bridge)
    bridge.list = async (path) => {
      if (path === "missing") throw new AppError("E_NOT_FOUND", "no such folder")
      return original(path)
    }
    const stores = createAppStores(bridge)
    await stores.files.getState().refresh()

    stores.files.getState().navigate("missing")
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(stores.files.getState().cwd).toBe(".")
    expect(stores.files.getState().entries.map((item) => item.name)).toContain("README.md")
    expect(stores.files.getState().loading).toBe(false)
  })
})

describe("storage permission flow (W-27)", () => {
  it("requests access, refreshes storage info and lists the folder again", async () => {
    const bridge = new MockBridge()
    let granted = false
    const list = entranceSpy(bridge)
    bridge.getStorageInfo = async () => ({
      hasPermission: granted,
      internalStorage: "/storage/emulated/0",
      downloads: "/storage/emulated/0/Download",
      documents: "/storage/emulated/0/Documents",
      workspace: "."
    })
    bridge.requestStoragePermission = async () => {
      granted = true
      return true
    }
    const stores = createAppStores(bridge)
    await stores.files.getState().loadStorage()
    expect(stores.files.getState().storage?.hasPermission).toBe(false)

    const result = await stores.files.getState().requestStoragePermission()

    expect(result).toBe(true)
    expect(stores.files.getState().storage?.hasPermission).toBe(true)
    expect(list.count()).toBeGreaterThan(0)
  })

  it("stays quiet for a bridge without a permission call", async () => {
    const bridge = new MockBridge()
    Object.defineProperty(bridge, "requestStoragePermission", { value: undefined })
    const stores = createAppStores(bridge)

    expect(await stores.files.getState().requestStoragePermission()).toBe(false)
  })
})

function entranceSpy(bridge: MockBridge) {
  const original = bridge.list.bind(bridge)
  let calls = 0
  bridge.list = async (path) => {
    calls += 1
    return original(path)
  }
  return { count: () => calls }
}
