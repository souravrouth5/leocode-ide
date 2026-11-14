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

/**
 * One settings store replaces the per-component hook. The storage event bridge
 * keeps a second window/tab in sync, as the hook did.
 */
export function createSettingsStore(): StoreApi<SettingsState> {
  const store = createStore<SettingsState>((set, get) => ({
    settings: loadSettings(),
    update(patch) {
      const next = { ...get().settings, ...patch }
      saveSettings(next)
      set({ settings: next })
    }
  }))

  if (typeof window !== "undefined") {
    const reload = () => store.setState({ settings: loadSettings() })
    window.addEventListener("leocode:settings-changed", reload)
    window.addEventListener("storage", reload)
  }

  return store
}
