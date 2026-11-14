import { createStore, type StoreApi } from "zustand/vanilla"
import type { Bridge, SearchMatch } from "../../bridge"
import { AppError } from "../../bridge"
import type { EditorStore } from "../editor/editorStore"
import type { ShellState } from "../shell/shellStore"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { ErrorsState } from "../../errors/errorsStore"
import { editorCommand } from "../editor/commands"

export interface SearchState {
  open: boolean
  query: string
  glob: string
  caseSensitive: boolean
  results: SearchMatch[]
  running: boolean
  count: number
  truncated: boolean
  searchId: string | null
  setOpen(open: boolean): void
  setQuery(query: string): void
  setGlob(glob: string): void
  setCaseSensitive(value: boolean): void
  search(): Promise<void>
  cancel(): void
  jump(match: SearchMatch): Promise<void>
}

interface SearchDeps {
  bridge: Bridge
  editor: EditorStore
  shell: StoreApi<ShellState>
  notifications: StoreApi<NotificationsState>
  errors: StoreApi<ErrorsState>
}

let sequence = 0

/**
 * Workspace-wide search (Task 16).
 *
 * Matches arrive as `search.match` events while the host walks the tree, so
 * results appear progressively. A new search cancels the previous one through
 * `fs.search.cancel` and a client-generated id; results are capped by the host.
 */
export function createSearchStore(deps: SearchDeps): StoreApi<SearchState> {
  const { bridge, editor, shell, notifications, errors } = deps

  return createStore<SearchState>((set, get) => ({
    open: false,
    query: "",
    glob: "",
    caseSensitive: false,
    results: [],
    running: false,
    count: 0,
    truncated: false,
    searchId: null,

    setOpen(open) {
      set({ open })
    },

    setQuery(query) {
      set({ query })
    },

    setGlob(glob) {
      set({ glob })
    },

    setCaseSensitive(caseSensitive) {
      set({ caseSensitive })
    },

    async search() {
      const { query, glob, caseSensitive, running, searchId } = get()
      if (!query.trim()) {
        set({ results: [], count: 0, truncated: false })
        return
      }
      if (running && searchId) {
        void bridge.cancelSearch(searchId).catch(() => {})
      }
      const id = `search-${Date.now()}-${++sequence}`
      set({
        open: true,
        running: true,
        results: [],
        count: 0,
        truncated: false,
        searchId: id
      })
      try {
        const summary = await bridge.search(
          query,
          {
            glob: glob.trim() || undefined,
            caseSensitive,
            searchId: id
          },
          (match) => set((state) => ({ results: [...state.results, match] }))
        )
        set({
          running: false,
          count: summary.count,
          truncated: summary.truncated,
          searchId: null
        })
      } catch (error) {
        set({ running: false, searchId: null })
        if (error instanceof AppError && error.code === "E_CANCELLED") return
        errors.getState().report(error, { context: "Search workspace" })
      }
    },

    cancel() {
      const { searchId } = get()
      if (searchId) void bridge.cancelSearch(searchId).catch(() => {})
      set({ running: false, searchId: null })
    },

    async jump(match) {
      await editor.getState().openFile(match.path)
      shell.getState().go("editor")
      // Wait for the tab to mount before the pane can receive the command.
      window.setTimeout(() => {
        editorCommand("gotoPosition", { line: match.line, col: match.col })
        notifications.getState().enqueue({
          kind: "info",
          message: `${match.path}:${match.line}`,
          durationMs: 2_000
        })
      }, 30)
    }
  }))
}
