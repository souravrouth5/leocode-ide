import { describe, expect, it } from "vitest"
import { MockBridge } from "../../bridge/mock"
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
