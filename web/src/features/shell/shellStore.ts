import { createStore, type StoreApi } from "zustand/vanilla"
import type { FileEntry } from "../../bridge"

export type View = "files" | "editor" | "terminal" | "runtimes"

export interface PromptState {
  title: string
  label: string
  initial: string
  kind: "file" | "dir" | "rename"
  target?: FileEntry
}

export interface ShellState {
  view: View
  sidebarOpen: boolean
  settingsOpen: boolean
  terminalMounted: boolean
  prompt: PromptState | null
  /** Transient status-bar text (2.2 s). */
  status: string | null
  setView(view: View): void
  go(view: View): void
  setSidebarOpen(open: boolean): void
  toggleSidebar(): void
  setSettingsOpen(open: boolean): void
  openPrompt(prompt: PromptState): void
  closePrompt(): void
  flash(text: string): void
}

export function createShellStore(): StoreApi<ShellState> {
  let statusTimer: number | null = null

  const store = createStore<ShellState>((set, get) => ({
    view: "editor",
    sidebarOpen: false,
    settingsOpen: false,
    terminalMounted: false,
    prompt: null,
    status: null,

    setView(view) {
      set({ view })
    },

    go(view) {
      if (view === "terminal") set({ terminalMounted: true })
      set({ view })
    },

    setSidebarOpen(sidebarOpen) {
      set({ sidebarOpen })
    },

    toggleSidebar() {
      set({ sidebarOpen: !get().sidebarOpen })
    },

    setSettingsOpen(settingsOpen) {
      set({ settingsOpen })
    },

    openPrompt(prompt) {
      set({ prompt })
    },

    closePrompt() {
      set({ prompt: null })
    },

    flash(text) {
      set({ status: text })
      if (statusTimer !== null) window.clearTimeout(statusTimer)
      statusTimer = window.setTimeout(() => {
        statusTimer = null
        set((state) => (state.status === text ? { status: null } : state))
      }, 2_200)
    }
  }))

  return store
}
