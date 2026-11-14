import { createStore, type StoreApi } from "zustand/vanilla"
import {
  loadSettings,
  saveSettings,
  type UserSettings
} from "../../settings/userSettings"

export interface SettingsState {
  settings: UserSettings
  update(patch: Partial<UserSettings>): void
}

export type SettingsStore = StoreApi<SettingsState> & {
  /** Remove the window listeners this store installed. */
  dispose(): void
}

/**
 * One settings store replaces the per-component hook. The storage event bridge
 * keeps a second window/tab in sync, as the hook did.
 */
export function createSettingsStore(): SettingsStore {
  const store = createStore<SettingsState>((set, get) => ({
    settings: loadSettings(),
    update(patch) {
      const next = { ...get().settings, ...patch }
      saveSettings(next)
      set({ settings: next })
    }
  }))

  let dispose = () => {}
  if (typeof window !== "undefined") {
    const reload = () => store.setState({ settings: loadSettings() })
    window.addEventListener("leocode:settings-changed", reload)
    window.addEventListener("storage", reload)
    dispose = () => {
      window.removeEventListener("leocode:settings-changed", reload)
      window.removeEventListener("storage", reload)
    }
  }

  const api = store as SettingsStore
  api.dispose = dispose
  return api
}
