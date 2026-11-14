import { createStore, type StoreApi } from "zustand/vanilla"
import type { Bridge, FileEntry, StorageInfo } from "../../bridge"
import type { ErrorsState } from "../../errors/errorsStore"

export interface FilesState {
  cwd: string
  entries: FileEntry[]
  loading: boolean
  storage: StorageInfo | null
  refresh(target?: string): Promise<void>
  navigate(path: string): void
  loadStorage(): Promise<void>
}

export function createFilesStore(
  bridge: Bridge,
  errors: StoreApi<ErrorsState>
): StoreApi<FilesState> {
  return createStore<FilesState>((set, get) => ({
    cwd: ".",
    entries: [],
    loading: true,
    storage: null,

    async refresh(target = get().cwd) {
      set({ loading: true })
      try {
        const entries = await bridge.list(target)
        set({ entries })
      } catch (error) {
        errors.getState().report(error, { context: "Refresh file list" })
      } finally {
        set({ loading: false })
      }
    },

    navigate(path) {
      set({ cwd: path })
      void get().refresh(path)
    },

    async loadStorage() {
      if (!bridge.getStorageInfo) return
      try {
        set({ storage: await bridge.getStorageInfo() })
      } catch (error) {
        errors.getState().report(error, { context: "Read storage info" })
      }
    }
  }))
}
