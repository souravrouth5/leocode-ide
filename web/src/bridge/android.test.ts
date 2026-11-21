import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AndroidBridge, BACKGROUND_CONTEXT, type InjectedChannel } from "./android"
import type { AppError } from "./types"

interface Sent {
  v: number
  id: string
  method: string
  payload: Record<string, unknown>
}

class FakeChannel implements InjectedChannel {
  readonly sent: Sent[] = []
  onmessage: ((event: { data: string }) => void) | null = null

  postMessage(data: string) {
    this.sent.push(JSON.parse(data) as Sent)
  }

  reply(index: number, payload: unknown) {
    this.deliver(index, { ok: true, payload })
  }

  fail(index: number, code: string, message = "failed") {
    this.deliver(index, { ok: false, error: { code, message } })
  }

  emit(index: number, event: string, payload: unknown) {
    const id = this.sent[index].id
    this.onmessage?.({ data: JSON.stringify({ v: 1, id, event, payload }) })
  }

  private deliver(index: number, body: Record<string, unknown>) {
    const id = this.sent[index].id
    this.onmessage?.({ data: JSON.stringify({ v: 1, id, ...body }) })
  }
}

describe("AndroidBridge transport (Task 11)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("uses the 20 s write timeout and does not retry a write", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.write("a.txt", "hello")
    const timedOut = expect(pending).rejects.toMatchObject({ code: "E_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(20_001)
    await timedOut

    expect(channel.sent).toHaveLength(1)
    expect(channel.sent[0].method).toBe("fs.write")
  })

  it("retries an idempotent read once after a timeout and ignores the late reply", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.list(".")
    await vi.advanceTimersByTimeAsync(10_001)
    expect(channel.sent).toHaveLength(2)

    channel.reply(1, [{ name: "a.txt" }])
    await expect(pending).resolves.toEqual([{ name: "a.txt" }])

    // The first request is settled; its late reply must not resolve anything.
    channel.reply(0, [{ name: "stale.txt" }])
    await Promise.resolve()
  })

  it("rejects a read with E_TIMEOUT after the single retry", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.read("a.txt")
    const timedOut = expect(pending).rejects.toMatchObject({ code: "E_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(10_001)
    await vi.advanceTimersByTimeAsync(10_001)
    await timedOut

    expect(channel.sent).toHaveLength(2)
  })

  it("cancels with an AbortSignal without posting the request", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    const controller = new AbortController()
    controller.abort()

    const pending = bridge.read("a.txt", { signal: controller.signal })

    await expect(pending).rejects.toMatchObject({ code: "E_CANCELLED" })
    expect(channel.sent).toHaveLength(0)
  })

  it("cancels a request that is already in flight", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    const controller = new AbortController()

    const pending = bridge.read("a.txt", { signal: controller.signal })
    expect(channel.sent).toHaveLength(1)
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: "E_CANCELLED" })

    // A late reply is dropped, and no timeout fires afterwards.
    channel.reply(0, { content: "late" })
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it("rejects every pending request on disconnect and drops late replies", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const read = bridge.read("a.txt")
    const list = bridge.list(".")
    bridge.disconnect()

    await expect(read).rejects.toMatchObject({ code: "E_BRIDGE_DISCONNECTED" })
    await expect(list).rejects.toMatchObject({ code: "E_BRIDGE_DISCONNECTED" })

    channel.reply(0, { content: "late" })
    await vi.advanceTimersByTimeAsync(60_000)
  })

  it("maps an unknown host error code to E_INTERNAL", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.read("a.txt")
    channel.fail(0, "E_NOT_A_REAL_CODE", "boom")
    await expect(pending).rejects.toMatchObject({
      code: "E_INTERNAL",
      message: "boom"
    })
  })

  it("cancels a process whose reply arrives after the timeout", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.run(["sleep", "10"], ".", () => {})
    const timedOut = expect(pending).rejects.toMatchObject({ code: "E_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(10_001)
    await timedOut

    channel.reply(0, { jobId: "job-1" })
    await vi.advanceTimersByTimeAsync(5)

    expect(channel.sent.some((message) => message.method === "proc.cancel")).toBe(true)
  })

  it("closes an orphan PTY whose open reply arrives after the timeout", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.openTerminal({
      cwd: ".",
      cols: 80,
      rows: 24,
      onData: () => {},
      onExit: () => {}
    })
    const timedOut = expect(pending).rejects.toMatchObject({ code: "E_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(10_001)
    await timedOut

    channel.reply(0, { sessionId: "session-1", pid: 42 })
    await vi.advanceTimersByTimeAsync(5)

    expect(channel.sent.some((message) => message.method === "term.close")).toBe(true)
  })

  it("accepts batched search.matches events and the single match event", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    const matches: Array<{ path: string; line: number }> = []

    const pending = bridge.search("needle", { searchId: "s-1" }, (match) =>
      matches.push(match)
    )
    expect(channel.sent[0].method).toBe("fs.search")

    channel.emit(0, "search.matches", [
      { path: "a.txt", line: 1, col: 1, preview: "a" },
      { path: "b.txt", line: 2, col: 1, preview: "b" },
      { path: "c.txt", line: 3, col: 1, preview: "c" }
    ])
    expect(matches).toHaveLength(3)

    channel.emit(0, "search.match", { path: "d.txt", line: 4, col: 1, preview: "d" })
    expect(matches).toHaveLength(4)
    expect(matches[3].path).toBe("d.txt")

    channel.reply(0, { count: 4, truncated: false })
    await expect(pending).resolves.toEqual({ count: 4, truncated: false })
  })

  it("sends fs.search.cancel when a search times out", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.search("needle", { searchId: "search-42" }, () => {})
    const timedOut = expect(pending).rejects.toMatchObject({ code: "E_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(60_000)
    await timedOut

    const cancel = channel.sent.find((message) => message.method === "fs.search.cancel")
    expect(cancel?.payload).toEqual({ searchId: "search-42" })
  })

  it("sends fs.search.cancel when a search is aborted after it was sent", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    const controller = new AbortController()

    const pending = bridge.search(
      "needle",
      { searchId: "search-abort" },
      () => {},
      { signal: controller.signal }
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ code: "E_CANCELLED" })
    const cancel = channel.sent.find((message) => message.method === "fs.search.cancel")
    expect(cancel?.payload).toEqual({ searchId: "search-abort" })
  })

  it("does not send fs.search.cancel for other timed-out methods", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.write("a.txt", "hello")
    const timedOut = expect(pending).rejects.toMatchObject({ code: "E_TIMEOUT" })
    await vi.advanceTimersByTimeAsync(20_001)
    await timedOut

    expect(channel.sent.some((message) => message.method === "fs.search.cancel")).toBe(false)
  })

  it("fails an open run and later calls after disconnect", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const run = bridge.run(["sleep", "10"], ".", () => {})
    channel.reply(0, { jobId: "job-1" })
    await Promise.resolve()

    bridge.disconnect()
    await expect(run).rejects.toMatchObject({ code: "E_BRIDGE_DISCONNECTED" })

    const before = channel.sent.length
    await expect(bridge.list(".")).rejects.toMatchObject({ code: "E_BRIDGE_DISCONNECTED" })
    expect(channel.sent).toHaveLength(before)
  })

  it("disconnects when the injected channel is replaced", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    ;(window as any).LeoCodeAndroid = { postMessage: () => {}, onmessage: null }

    await expect(bridge.list(".")).rejects.toMatchObject({ code: "E_BRIDGE_DISCONNECTED" })
    expect(channel.sent).toHaveLength(0)
    delete (window as any).LeoCodeAndroid
  })

  it("fails fast after three consecutive timeouts", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    for (let index = 0; index < 3; index += 1) {
      const pending = bridge.write(`f${index}.txt`, "x")
      const timedOut = expect(pending).rejects.toMatchObject({ code: "E_TIMEOUT" })
      await vi.advanceTimersByTimeAsync(20_001)
      await timedOut
    }

    const before = channel.sent.length
    await expect(bridge.read("a.txt")).rejects.toMatchObject({ code: "E_BRIDGE_DISCONNECTED" })
    expect(channel.sent).toHaveLength(before)
  })

  it("rejects an oversize request without posting it", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    await expect(bridge.write("big.txt", "x".repeat(9 * 1024 * 1024))).rejects.toMatchObject({
      code: "E_LIMIT"
    })
    expect(channel.sent).toHaveLength(0)
  })

  it("survives a stream payload that throws", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    const opening = bridge.openTerminal({
      cwd: ".",
      cols: 80,
      rows: 24,
      onData: () => {},
      onExit: () => {}
    })
    channel.reply(0, { sessionId: "s1", pid: 1 })
    const handle = await opening
    expect(handle).not.toBeNull()

    expect(() => channel.emit(0, "term.data", { b64: "not-base64!!" })).not.toThrow()
  })

  it("acks terminal data only after it is rendered", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    const received: Array<{ done?: () => void }> = []

    const opening = bridge.openTerminal({
      cwd: ".",
      cols: 80,
      rows: 24,
      onData: (_bytes, done) => {
        received.push({ done })
      },
      onExit: () => {}
    })
    channel.reply(0, { sessionId: "s1", pid: 1 })
    await opening

    channel.emit(0, "term.data", { b64: btoa("hi") })
    await Promise.resolve()
    expect(channel.sent.filter((message) => message.method === "term.ack")).toHaveLength(0)

    received[0]?.done?.()
    await Promise.resolve()
    expect(channel.sent.filter((message) => message.method === "term.ack")).toHaveLength(1)
  })

  // ---------------------------------------------------------------- W-23

  /** Index of the most recent request of `method`, or -1. */
  function lastSent(channel: FakeChannel, method: string): number {
    for (let index = channel.sent.length - 1; index >= 0; index -= 1) {
      if (channel.sent[index].method === method) return index
    }
    return -1
  }

  async function openTerminal(bridge: AndroidBridge, channel: FakeChannel) {
    const opening = bridge.openTerminal({
      cwd: ".",
      cols: 80,
      rows: 24,
      onData: () => {},
      onExit: () => {}
    })
    channel.reply(0, { sessionId: "s1", pid: 1 })
    const handle = await opening
    expect(handle).not.toBeNull()
    return handle!
  }

  it("reports a burst of failing terminal writes once", async () => {
    const channel = new FakeChannel()
    const onBackgroundError = vi.fn()
    const bridge = new AndroidBridge(channel, { onBackgroundError })
    const handle = await openTerminal(bridge, channel)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      handle.write(new Uint8Array([0x6c, 0x73]))
      await vi.advanceTimersByTimeAsync(20)
      const write = lastSent(channel, "term.write")
      expect(write, `term.write ${attempt}`).toBeGreaterThan(-1)
      channel.fail(write, "E_IO", "the PTY is gone")
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(onBackgroundError).toHaveBeenCalledTimes(1)
    const [error, context] = onBackgroundError.mock.calls[0] as [AppError, string]
    expect(context).toBe(BACKGROUND_CONTEXT.terminalInput)
    expect(error.code).toBe("E_IO")
    expect(error.message).toContain("Terminal input is not reaching the shell")
  })

  it("stays quiet while terminal input reaches the shell", async () => {
    const channel = new FakeChannel()
    const onBackgroundError = vi.fn()
    const bridge = new AndroidBridge(channel, { onBackgroundError })
    const handle = await openTerminal(bridge, channel)

    handle.write(new Uint8Array([0x61]))
    await vi.advanceTimersByTimeAsync(20)
    channel.reply(lastSent(channel, "term.write"), {})
    await vi.advanceTimersByTimeAsync(0)

    expect(onBackgroundError).not.toHaveBeenCalled()
  })

  it("reports a burst of failed process stops once", async () => {
    const channel = new FakeChannel()
    const onBackgroundError = vi.fn()
    const bridge = new AndroidBridge(channel, { onBackgroundError })

    let cancel: (() => void) | null = null
    void bridge.run(["sleep", "10"], ".", () => {}, (handle) => {
      cancel = handle.cancel
    })
    channel.reply(0, { jobId: "job-1" })
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve()
    expect(cancel).not.toBeNull()

    for (let attempt = 0; attempt < 2; attempt += 1) {
      cancel!()
      channel.fail(lastSent(channel, "proc.cancel"), "E_TIMEOUT", "host busy")
      await vi.advanceTimersByTimeAsync(0)
    }

    expect(onBackgroundError).toHaveBeenCalledTimes(1)
    expect(onBackgroundError.mock.calls[0][1]).toBe(BACKGROUND_CONTEXT.stopProcess)
  })
})

describe("runtime install jobs (Task 25)", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function lastSent(channel: FakeChannel, method: string): number {
    for (let i = channel.sent.length - 1; i >= 0; i -= 1) {
      if (channel.sent[i].method === method) return i
    }
    throw new Error(`no ${method} was sent`)
  }

  it("resolves on the terminal runtime.result, not on the start reply", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    const phases: string[] = []

    let settled = false
    const pending = bridge
      .installRuntime("python", (progress) => phases.push(progress.phase))
      .then(() => {
        settled = true
      })

    channel.reply(0, { id: "python", started: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)

    channel.emit(0, "runtime.progress", {
      phase: "download",
      bytes: 10,
      total: 100,
      message: "Downloading"
    })
    channel.emit(0, "runtime.result", { id: "python", ok: true })
    await pending

    expect(phases).toEqual(["download"])
    expect(channel.sent[0].method).toBe("runtime.install")
    expect(channel.sent[0].payload).toEqual({ id: "python" })
  })

  it("rejects with the code from a failed runtime.result", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.installRuntime("python", () => {})
    const rejected = expect(pending).rejects.toMatchObject({
      code: "E_HEALTH_CHECK",
      message: "the runtime did not start correctly after installing"
    })

    channel.reply(0, { id: "python", started: true })
    channel.emit(0, "runtime.result", {
      id: "python",
      ok: false,
      code: "E_HEALTH_CHECK",
      message: "the runtime did not start correctly after installing"
    })
    await rejected
  })

  it("maps an unknown result code onto E_INTERNAL", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const pending = bridge.installRuntime("python", () => {})
    const rejected = expect(pending).rejects.toMatchObject({ code: "E_INTERNAL" })

    channel.reply(0, { id: "python", started: true })
    channel.emit(0, "runtime.result", { id: "python", ok: false, code: "E_WHAT" })
    await rejected
  })

  it("sends runtime.repair and cancels it through runtime.cancel", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)
    let cancel: (() => void) | null = null

    const pending = bridge.repairRuntime("python", () => {}, (handle) => {
      cancel = handle.cancel
    })
    channel.reply(0, { id: "python", started: true })
    await vi.advanceTimersByTimeAsync(0)

    expect(channel.sent[0].method).toBe("runtime.repair")
    expect(cancel).not.toBeNull()
    cancel!()
    expect(channel.sent[lastSent(channel, "runtime.cancel")].payload).toEqual({ id: "python" })

    channel.emit(0, "runtime.result", { id: "python", ok: true })
    await pending
  })

  it("reads the catalog and removes a runtime", async () => {
    const channel = new FakeChannel()
    const bridge = new AndroidBridge(channel)

    const catalog = bridge.catalogRuntimes()
    channel.reply(0, [
      {
        id: "python",
        version: "3.14.10",
        versionCode: 31410,
        installed: true,
        healthy: true,
        installedVersionCode: 31410
      }
    ])
    await expect(catalog).resolves.toHaveLength(1)
    expect(channel.sent[0].method).toBe("runtime.catalog")

    const removed = bridge.uninstallRuntime("python")
    channel.reply(lastSent(channel, "runtime.uninstall"), {})
    await removed
    expect(channel.sent[lastSent(channel, "runtime.uninstall")].payload).toEqual({
      id: "python"
    })
  })
})
