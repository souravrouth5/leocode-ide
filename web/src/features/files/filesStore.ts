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
  /**
   * Ask Android for shared-storage access and pick up the result (W-27). The
   * bridge call is user-wait: it resolves when the system dialog is answered.
   */
  requestStoragePermission(): Promise<boolean>
}

export function createFilesStore(
  bridge: Bridge,
  errors: StoreApi<ErrorsState>
): StoreApi<FilesState> {
  /**
   * Only the newest list request may commit entries or clear `loading` (W-15).
   * Two quick navigations otherwise leave folder A's rows under folder B.
   */
  let requestSeq = 0

  return createStore<FilesState>((set, get) => ({
    cwd: ".",
    entries: [],
    loading: true,
    storage: null,

    async refresh(target = get().cwd) {
      const token = ++requestSeq
      set({ loading: true })
      try {
        const entries = await bridge.list(target)
        if (token !== requestSeq) return
        // `cwd` follows a *successful* list, not the tap (W-15).
        set({ entries, cwd: target, loading: false })
      } catch (error) {
        if (token !== requestSeq) return
        errors.getState().report(error, { context: "Refresh file list" })
        set({ loading: false })
      }
    },

    navigate(path) {
      // Do not commit `cwd` until the folder actually lists: a failing path must
      // not leave the address bar pointing at a folder whose rows are the old one.
      void get().refresh(path)
    },

    async loadStorage() {
      if (!bridge.getStorageInfo) return
      try {
        set({ storage: await bridge.getStorageInfo() })
      } catch (error) {
        errors.getState().report(error, { context: "Read storage info" })
      }
    },

    async requestStoragePermission() {
      if (!bridge.requestStoragePermission) return false
      try {
        const granted = await bridge.requestStoragePermission()
        // The host may flip `hasPermission`; read it back instead of assuming.
        await get().loadStorage()
        if (granted) await get().refresh()
        return granted
      } catch (error) {
        errors.getState().report(error, { context: "Request storage access" })
        return false
      }
    }
  }))
}
