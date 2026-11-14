import { describe, expect, it } from "vitest"
import {
  NOTICE_DURATION_MS,
  NOTICE_QUEUE_LIMIT,
  createNotificationsStore
} from "./notificationsStore"

describe("snackbar queue (W-10)", () => {
  it("keeps a null duration sticky", () => {
    const store = createNotificationsStore()
    store.getState().enqueue({ kind: "info", message: "Undo delete", durationMs: null })

    expect(store.getState().queue[0].durationMs).toBeNull()
  })

  it("uses the default only when the duration is omitted", () => {
    const store = createNotificationsStore()
    store.getState().enqueue({ kind: "success", message: "Saved" })

    expect(store.getState().queue[0].durationMs).toBe(NOTICE_DURATION_MS)
  })

  it("collapses an identical notice that is already queued", () => {
    const store = createNotificationsStore()
    store.getState().enqueue({ kind: "warning", message: "Not found", detail: "a.txt" })
    store.getState().enqueue({ kind: "warning", message: "Not found", detail: "a.txt" })

    expect(store.getState().queue).toHaveLength(1)
    // The newest copy still refreshes the timer.
    expect(store.getState().queue[0].durationMs).toBe(NOTICE_DURATION_MS)
  })

  it("keeps distinct notices apart", () => {
    const store = createNotificationsStore()
    store.getState().enqueue({ kind: "warning", message: "Not found", detail: "a.txt" })
    store.getState().enqueue({ kind: "warning", message: "Not found", detail: "b.txt" })

    expect(store.getState().queue).toHaveLength(2)
  })

  it("caps the queue so a failing loop cannot flood the UI", () => {
    const store = createNotificationsStore()
    for (let index = 0; index < NOTICE_QUEUE_LIMIT + 4; index += 1) {
      store.getState().enqueue({ kind: "warning", message: `failure ${index}` })
    }

    const queue = store.getState().queue
    expect(queue).toHaveLength(NOTICE_QUEUE_LIMIT)
    expect(queue[queue.length - 1].message).toBe(`failure ${NOTICE_QUEUE_LIMIT + 3}`)
  })
})
