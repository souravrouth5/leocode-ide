import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AndroidBridge, type InjectedChannel } from "./android"

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
})
