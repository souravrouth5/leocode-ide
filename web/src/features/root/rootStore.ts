import { createStore } from "zustand/vanilla"
import type { Bridge } from "../../bridge/types"

export interface RootState {
  available: boolean
  granted: boolean
  enabled: boolean
  loading: boolean
  warningOpen: boolean
  lastLost: { reason: string; at: number } | null
  liveRootCount: number
  checkStatus: () => Promise<void>
  requestRoot: () => Promise<boolean>
  disableRoot: () => void
  openWarning: () => void
  closeWarning: () => void
  onRootLost: () => void
}

export type RootStore = ReturnType<typeof createRootStore>

export function createRootStore(bridge: Bridge) {
  return createStore<RootState>((set) => {
    bridge.onRootLost?.(() => {
      set({ granted: false, enabled: false })
    })

    return {
      available: false,
      granted: false,
      enabled: false,
      loading: false,
      warningOpen: false,
      lastLost: null,
      liveRootCount: 0,

      openWarning: () => set({ warningOpen: true }),
      closeWarning: () => set({ warningOpen: false }),

      checkStatus: async () => {
        set({ loading: true })
        try {
          const status = await bridge.rootStatus()
          set({
            available: status.available,
            granted: status.granted,
            enabled: status.enabled,
            loading: false
          })
        } catch {
          set({ available: false, granted: false, enabled: false, loading: false })
        }
      },

      requestRoot: async () => {
        set({ loading: true, warningOpen: false })
        try {
          const res = await bridge.rootRequest()
          if (res.granted) {
            set({ granted: true, enabled: true, loading: false })
            return true
          }
          set({ granted: false, enabled: false, loading: false })
          return false
        } catch (error) {
          set({ granted: false, enabled: false, loading: false })
          throw error
        }
      },

      disableRoot: () => {
        set({ enabled: false })
      },

      onRootLost: () => {
        set({ granted: false, enabled: false })
      }
    }
  })
}
