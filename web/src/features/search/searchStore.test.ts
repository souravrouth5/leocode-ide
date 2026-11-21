import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import {
  AppError,
  type SearchMatch,
  type SearchOptions,
  type SearchSummary
} from "../../bridge"
import { MockBridge } from "../../bridge/mock"
import { JUMP_MAX_ATTEMPTS, JUMP_RETRY_MS } from "./searchStore"

beforeEach(() => {
  localStorage.clear()
})

interface PendingSearch {
  options: SearchOptions
  onMatch: (match: SearchMatch) => void
  resolve: (summary: SearchSummary) => void
  reject: (error: unknown) => void
}

/** A bridge whose searches stay pending until the test settles them. */
function deferSearches(bridge: MockBridge): PendingSearch[] {
  const calls: PendingSearch[] = []
  vi.spyOn(bridge, "search").mockImplementation(
    (_query, options, onMatch) =>
      new Promise<SearchSummary>((resolve, reject) => {
        calls.push({ options, onMatch, resolve, reject })
      })
  )
  return calls
}

const match = (path: string, line: number): SearchMatch => ({
  path,
  line,
  col: 1,
  preview: `line ${line}`
})

const lastNotice = (stores: ReturnType<typeof createAppStores>) => {
  const queue = stores.notifications.getState().queue
  return queue[queue.length - 1]
}

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

  it("ignores a stale reply and stale matches from a superseded search", async () => {
    const bridge = new MockBridge()
    const calls = deferSearches(bridge)
    const stores = createAppStores(bridge)

    stores.search.getState().setQuery("first")
    const first = stores.search.getState().search()
    await Promise.resolve()

    stores.search.getState().setQuery("second")
    const second = stores.search.getState().search()
    await Promise.resolve()

    expect(calls).toHaveLength(2)
    const staleId = calls[0].options.searchId
    const currentId = calls[1].options.searchId
    expect(currentId).toBeTruthy()
    expect(currentId).not.toBe(staleId)

    // The old request's reply must not clear the running state of the new one.
    calls[0].resolve({ count: 9, truncated: true })
    await first
    expect(stores.search.getState()).toMatchObject({
      running: true,
      count: 0,
      truncated: false,
      searchId: currentId
    })

    // Its still-registered stream must not append to the new results.
    calls[0].onMatch(match("stale.txt", 1))
    expect(stores.search.getState().results).toEqual([])

    calls[1].onMatch(match("fresh.txt", 2))
    expect(stores.search.getState().results).toEqual([match("fresh.txt", 2)])

    calls[1].resolve({ count: 1, truncated: false })
    await second
    expect(stores.search.getState()).toMatchObject({
      running: false,
      count: 1,
      truncated: false,
      searchId: null,
      results: [match("fresh.txt", 2)]
    })
  })

  it("ignores a cancelled search's late reply and matches", async () => {
    const bridge = new MockBridge()
    const calls = deferSearches(bridge)
    const stores = createAppStores(bridge)

    stores.search.getState().setQuery("first")
    const first = stores.search.getState().search()
    await Promise.resolve()

    stores.search.getState().cancel()
    expect(stores.search.getState().searchId).toBeNull()

    stores.search.getState().setQuery("second")
    const second = stores.search.getState().search()
    await Promise.resolve()
    const currentId = calls[1].options.searchId

    calls[0].onMatch(match("cancelled.txt", 1))
    expect(stores.search.getState().results).toEqual([])

    calls[0].resolve({ count: 5, truncated: true })
    await first
    expect(stores.search.getState()).toMatchObject({
      running: true,
      count: 0,
      truncated: false,
      searchId: currentId
    })

    calls[1].resolve({ count: 0, truncated: false })
    await second
    expect(stores.search.getState()).toMatchObject({
      running: false,
      count: 0,
      truncated: false,
      searchId: null
    })
  })

  it("does not report E_CANCELLED as a search error", async () => {
    const bridge = new MockBridge()
    const calls = deferSearches(bridge)
    const stores = createAppStores(bridge)

    stores.search.getState().setQuery("print")
    const pending = stores.search.getState().search()
    await Promise.resolve()
    calls[0].reject(new AppError("E_CANCELLED", "search cancelled"))
    await pending

    expect(stores.errors.getState().banner).toBeNull()
    expect(stores.errors.getState().sheet).toBeNull()
    expect(stores.notifications.getState().queue).toEqual([])
    expect(stores.search.getState()).toMatchObject({ running: false, searchId: null })
  })

  it("still reports a real error from the current search", async () => {
    const bridge = new MockBridge()
    const calls = deferSearches(bridge)
    const stores = createAppStores(bridge)

    stores.search.getState().setQuery("print")
    const pending = stores.search.getState().search()
    await Promise.resolve()
    calls[0].reject(new AppError("E_IO", "the disk failed"))
    await pending

    expect(stores.errors.getState().sheet?.error.code).toBe("E_IO")
    expect(stores.search.getState()).toMatchObject({ running: false, searchId: null })
  })

  it("resets results and cancels the host search on a workspace switch", () => {
    const bridge = new MockBridge()
    const cancel = vi.spyOn(bridge, "cancelSearch")
    const stores = createAppStores(bridge)
    stores.search.setState({
      results: [match("old.txt", 1)],
      count: 1,
      truncated: true,
      running: true,
      searchId: "live"
    })

    window.dispatchEvent(new CustomEvent("leocode:workspace-switched"))

    expect(cancel).toHaveBeenCalledWith("live")
    expect(stores.search.getState()).toMatchObject({
      results: [],
      count: 0,
      truncated: false,
      running: false,
      searchId: null
    })
  })

  it("ignores a cancelled search's late reply after a workspace switch", async () => {
    const bridge = new MockBridge()
    const calls = deferSearches(bridge)
    const stores = createAppStores(bridge)

    stores.search.getState().setQuery("print")
    const pending = stores.search.getState().search()
    await Promise.resolve()

    window.dispatchEvent(new CustomEvent("leocode:workspace-switched"))
    expect(stores.search.getState().searchId).toBeNull()

    calls[0].onMatch(match("old.txt", 1))
    calls[0].resolve({ count: 4, truncated: true })
    await pending

    expect(stores.search.getState()).toMatchObject({
      results: [],
      count: 0,
      truncated: false,
      running: false,
      searchId: null
    })
  })

  it("jumps to the file and line of a match after the pane acknowledges it", async () => {
    const stores = createAppStores(new MockBridge())
    const commands: Array<{ action: string; value?: { token?: string } }> = []
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string; value?: { token?: string } }>).detail
      commands.push(detail)
      window.dispatchEvent(
        new CustomEvent("leocode:editor-command-ack", {
          detail: { action: detail.action, token: detail.value?.token }
        })
      )
    }
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
      expect(commands).toHaveLength(1)
      expect(commands[0]).toEqual({
        action: "gotoPosition",
        value: { line: 8, col: 5, token: expect.any(String) }
      })
      expect(lastNotice(stores)).toMatchObject({
        kind: "info",
        message: "main.py:8"
      })
    } finally {
      window.removeEventListener("leocode:editor-command", listener)
    }
  })

  it("retries the goto command until the pane acknowledges it", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.editor.getState().openFile("main.py")

    vi.useFakeTimers()
    const commands: Array<{ action: string; value?: { token?: string } }> = []
    const listener = (event: Event) => {
      commands.push(
        (event as CustomEvent<{ action: string; value?: { token?: string } }>).detail
      )
    }
    window.addEventListener("leocode:editor-command", listener)

    try {
      const jumping = stores.search.getState().jump({
        path: "main.py",
        line: 8,
        col: 5,
        preview: "print(greet(...))"
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(commands).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(JUMP_RETRY_MS)
      expect(commands).toHaveLength(2)

      window.dispatchEvent(
        new CustomEvent("leocode:editor-command-ack", {
          detail: { action: "gotoPosition", token: commands[1].value?.token }
        })
      )
      await vi.advanceTimersByTimeAsync(JUMP_RETRY_MS * 2)

      expect(commands).toHaveLength(2)
      expect(lastNotice(stores)).toMatchObject({
        kind: "info",
        message: "main.py:8"
      })
      await jumping
    } finally {
      window.removeEventListener("leocode:editor-command", listener)
      vi.useRealTimers()
    }
  })

  it("notifies when the pane never acknowledges the goto command", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.editor.getState().openFile("main.py")

    vi.useFakeTimers()
    const commands: unknown[] = []
    const listener = (event: Event) => {
      commands.push((event as CustomEvent).detail)
    }
    window.addEventListener("leocode:editor-command", listener)

    try {
      const jumping = stores.search.getState().jump({
        path: "main.py",
        line: 8,
        col: 5,
        preview: "print(greet(...))"
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(commands).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(JUMP_RETRY_MS * JUMP_MAX_ATTEMPTS)
      expect(commands).toHaveLength(JUMP_MAX_ATTEMPTS)
      const notice = lastNotice(stores)
      expect(notice).toMatchObject({ kind: "warning" })
      expect(notice?.message).toContain("Could not jump")
      await jumping
    } finally {
      window.removeEventListener("leocode:editor-command", listener)
      vi.useRealTimers()
    }
  })

  it("does not dispatch a jump beyond the loaded chunk of a large file", async () => {
    const stores = createAppStores(new MockBridge())
    stores.editor.setState({
      docs: [
        {
          path: "big.txt",
          content: "one\ntwo\n",
          saved: "one\ntwo\n",
          eol: "\n",
          readOnly: true,
          large: true,
          truncated: true
        }
      ],
      activePath: "big.txt"
    })
    const commands: unknown[] = []
    const listener = (event: Event) => {
      commands.push((event as CustomEvent).detail)
    }
    window.addEventListener("leocode:editor-command", listener)

    try {
      await stores.search.getState().jump({
        path: "big.txt",
        line: 50,
        col: 1,
        preview: "far below"
      })

      expect(commands).toEqual([])
      expect(stores.shell.getState().view).toBe("editor")
      const notice = lastNotice(stores)
      expect(notice).toMatchObject({ kind: "warning" })
      expect(notice?.message).toContain("outside the loaded part")
    } finally {
      window.removeEventListener("leocode:editor-command", listener)
    }
  })
})
