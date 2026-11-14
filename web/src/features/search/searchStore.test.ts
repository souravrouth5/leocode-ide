import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"

beforeEach(() => {
  localStorage.clear()
})

describe("workspace search store (Task 16)", () => {
  it("streams matches into the panel and finishes with a summary", async () => {
    const stores = createAppStores(new MockBridge())
    stores.search.getState().setQuery("print")
    stores.search.getState().setGlob("*.py")

    await stores.search.getState().search()

    const state = stores.search.getState()
    expect(state.running).toBe(false)
    expect(state.searchId).toBeNull()
    expect(state.count).toBeGreaterThan(0)
    expect(state.results).toHaveLength(state.count)
    expect(state.truncated).toBe(false)
    expect(state.results.every((match) => match.path.endsWith(".py"))).toBe(true)
  })

  it("clears results for an empty query without calling the bridge", async () => {
    const bridge = new MockBridge()
    const search = vi.spyOn(bridge, "search")
    const stores = createAppStores(bridge)
    stores.search.setState({ results: [{ path: "a", line: 1, col: 1, preview: "a" }], count: 1 })
    stores.search.getState().setQuery("   ")

    await stores.search.getState().search()

    expect(search).not.toHaveBeenCalled()
    expect(stores.search.getState().results).toEqual([])
    expect(stores.search.getState().count).toBe(0)
  })

  it("cancels the running search before starting a new one", async () => {
    const bridge = new MockBridge()
    const cancel = vi.spyOn(bridge, "cancelSearch")
    const stores = createAppStores(bridge)
    stores.search.setState({ query: "print", running: true, searchId: "old-search" })

    await stores.search.getState().search()

    expect(cancel).toHaveBeenCalledWith("old-search")
    expect(stores.search.getState().running).toBe(false)
  })

  it("cancels through the host and stops the spinner", () => {
    const bridge = new MockBridge()
    const cancel = vi.spyOn(bridge, "cancelSearch")
    const stores = createAppStores(bridge)
    stores.search.setState({ running: true, searchId: "live" })

    stores.search.getState().cancel()

    expect(cancel).toHaveBeenCalledWith("live")
    expect(stores.search.getState().running).toBe(false)
    expect(stores.search.getState().searchId).toBeNull()
  })

  it("jumps to the file and line of a match", async () => {
    const stores = createAppStores(new MockBridge())
    const listener = vi.fn()
    window.addEventListener("leocode:editor-command", listener)

    try {
      await stores.search.getState().jump({
        path: "main.py",
        line: 8,
        col: 5,
        preview: "print(greet(...))"
      })

      expect(stores.editor.getState().activePath).toBe("main.py")
      expect(stores.shell.getState().view).toBe("editor")
      await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1))
      expect(listener.mock.calls[0][0].detail).toEqual({
        action: "gotoPosition",
        value: { line: 8, col: 5 }
      })
    } finally {
      window.removeEventListener("leocode:editor-command", listener)
    }
  })
})
