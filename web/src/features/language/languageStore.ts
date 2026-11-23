import { createStore } from "zustand/vanilla"
import type { Bridge, LanguageDescriptor } from "../../bridge/types"

export interface LanguageState {
  languages: LanguageDescriptor[]
  loaded: boolean
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  findForFile: (path: string) => LanguageDescriptor | undefined
  getLanguage: (id: string) => LanguageDescriptor | undefined
}

export function createLanguageStore(bridge: Bridge) {
  return createStore<LanguageState>((set, get) => ({
    languages: [],
    loaded: false,
    loading: false,
    error: null,

    refresh: async () => {
      set({ loading: true, error: null })
      try {
        const reply = await bridge.languageList()
        set({ languages: reply.languages ?? [], loaded: true, loading: false })
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Failed to load languages"
        set({ error: message, loading: false, loaded: true })
      }
    },

    findForFile: (path: string) => {
      const ext = path.split(".").pop()?.toLowerCase() ?? ""
      if (!ext) return undefined
      return get().languages.find(lang =>
        lang.extensions.map(e => e.toLowerCase()).includes(ext)
      )
    },

    getLanguage: (id: string) => {
      return get().languages.find(lang => lang.id === id)
    }
  }))
}

export type LanguageStore = ReturnType<typeof createLanguageStore>
