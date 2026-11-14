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
  enqueue(input: Omit<Notice, "id"> & { id?: string }): string
  dismiss(id: string): void
  clear(): void
}

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
      set((state) => ({
        queue: [...state.queue, { ...input, id, durationMs: input.durationMs ?? 4_500 }]
      }))
      return id
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
