import { useStore as useZustandStore } from "zustand"
import { createStore, type StoreApi } from "zustand/vanilla"

export type NoticeKind = "info" | "success" | "warning" | "error"

export interface NoticeAction {
  label: string
  run: () => void
}

export interface Notice {
  id: string
  kind: NoticeKind
  message: string
  detail?: string
  action?: NoticeAction
  /** `null` keeps the snackbar until the user dismisses it. */
  durationMs: number | null
}

export interface NotificationsState {
  /** Newest last; the snackbar host shows the oldest first. */
  queue: Notice[]
  enqueue(
    input: Omit<Notice, "id" | "durationMs"> & { id?: string; durationMs?: number | null }
  ): string
  dismiss(id: string): void
  clear(): void
}

/** Default lifetime when the caller does not name one. */
export const NOTICE_DURATION_MS = 4_500
/**
 * At most this many notices wait in line. A failing loop that reports on every
 * attempt must not queue a minute of snackbars (W-10).
 */
export const NOTICE_QUEUE_LIMIT = 5

let sequence = 0

/**
 * Snackbar queue, Task 12. Kept free of React so stores and bridge errors can
 * enqueue notices, and so the host component can be tested with plain props.
 */
export function createNotificationsStore(): StoreApi<NotificationsState> {
  return createStore<NotificationsState>((set) => ({
    queue: [],
    enqueue(input) {
      const id = input.id ?? `notice-${++sequence}`
      // `null` means "sticky"; only an omitted duration gets the default (W-10).
      const durationMs = input.durationMs === undefined ? NOTICE_DURATION_MS : input.durationMs
      let resultId = id
      set((state) => {
        // Collapse an identical notice that is already waiting instead of
        // stacking duplicates one after another.
        const duplicate = state.queue.find(
          (notice) =>
            notice.message === input.message &&
            notice.detail === input.detail &&
            notice.kind === input.kind
        )
        if (duplicate) {
          resultId = duplicate.id
          return {
            queue: state.queue.map((notice) =>
              notice.id === duplicate.id ? { ...input, id: duplicate.id, durationMs } : notice
            )
          }
        }
        return {
          queue: [...state.queue, { ...input, id, durationMs }].slice(-NOTICE_QUEUE_LIMIT)
        }
      })
      return resultId
    },
    dismiss(id) {
      set((state) => ({ queue: state.queue.filter((notice) => notice.id !== id) }))
    },
    clear() {
      set({ queue: [] })
    }
  }))
}

export function useNotificationsStore<T>(
  store: StoreApi<NotificationsState>,
  selector: (state: NotificationsState) => T
): T {
  return useZustandStore(store, selector)
}
