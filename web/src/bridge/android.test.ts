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
})
