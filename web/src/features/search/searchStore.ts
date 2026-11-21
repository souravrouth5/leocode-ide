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
  /** Drop results from the previous workspace and stop its host search. */
  reset(): void
  jump(match: SearchMatch): Promise<void>
}

interface SearchDeps {
  bridge: Bridge
  editor: EditorStore
  shell: StoreApi<ShellState>
  notifications: StoreApi<NotificationsState>
  errors: StoreApi<ErrorsState>
}

/** How long the editor pane has to acknowledge a goto command. */
export const JUMP_RETRY_MS = 50
/** Attempts before the jump reports that the pane never answered. */
export const JUMP_MAX_ATTEMPTS = 20

let sequence = 0
let jumpSequence = 0

const loadedLineCount = (content: string): number =>
  content.length === 0 ? 1 : content.split("\n").length

/**
 * Workspace-wide search (Task 16).
 *
 * Matches arrive as `search.matches` batches while the host walks the tree, so
 * results appear progressively. A new search cancels the previous one through
 * `fs.search.cancel` and a client-generated id; results are capped by the host.
 * Every reply and stream is tagged with that id so a superseded search cannot
 * overwrite or append to a newer one (PD-04).
 */
export function createSearchStore(deps: SearchDeps): StoreApi<SearchState> {
  const { bridge, editor, shell, notifications, errors } = deps

  const store = createStore<SearchState>((set, get) => ({
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
          (match) => {
            // A cancelled or superseded request may still have a live stream.
            if (get().searchId !== id) return
            set((state) => ({ results: [...state.results, match] }))
          }
        )
        // The user started another search (or switched workspace) meanwhile.
        if (get().searchId !== id) return
        set({
          running: false,
          count: summary.count,
          truncated: summary.truncated,
          searchId: null
        })
      } catch (error) {
        if (get().searchId === id) set({ running: false, searchId: null })
        if (error instanceof AppError && error.code === "E_CANCELLED") return
        // A real failure is worth surfacing even when its search was superseded.
        errors.getState().report(error, { context: "Search workspace" })
      }
    },

    cancel() {
      const { searchId } = get()
      if (searchId) void bridge.cancelSearch(searchId).catch(() => {})
      set({ running: false, searchId: null })
    },

    reset() {
      const { searchId } = get()
      if (searchId) void bridge.cancelSearch(searchId).catch(() => {})
      set({
        results: [],
        count: 0,
        truncated: false,
        running: false,
        searchId: null
      })
    },

    async jump(match) {
      await editor.getState().openFile(match.path)
      shell.getState().go("editor")

      const doc = editor.getState().docs.find((item) => item.path === match.path)
      if (
        doc &&
        (doc.readOnly || doc.large) &&
        match.line > loadedLineCount(doc.content)
      ) {
        notifications.getState().enqueue({
          kind: "warning",
          message: `${match.path}:${match.line} is outside the loaded part of the file`,
          durationMs: 4_000
        })
        return
      }

      const token = `goto-${Date.now()}-${++jumpSequence}`
      let attempts = 0
      let timer: number | null = null
      let settled = false

      const cleanup = () => {
        if (timer !== null) {
          window.clearTimeout(timer)
          timer = null
        }
        window.removeEventListener("leocode:editor-command-ack", onAck)
      }

      const announceSuccess = () => {
        notifications.getState().enqueue({
          kind: "info",
          message: `${match.path}:${match.line}`,
          durationMs: 2_000
        })
      }

      const onAck = (event: Event) => {
        if (settled) return
        const detail = (event as CustomEvent<{ token?: string }>).detail
        if (!detail || detail.token !== token) return
        settled = true
        cleanup()
        announceSuccess()
      }

      window.addEventListener("leocode:editor-command-ack", onAck)

      const attempt = () => {
        if (settled) return
        attempts += 1
        editorCommand("gotoPosition", { line: match.line, col: match.col, token })
        // An ack can arrive synchronously from the dispatch above.
        if (settled) return

        if (attempts >= JUMP_MAX_ATTEMPTS) {
          timer = window.setTimeout(() => {
            timer = null
            if (settled) return
            settled = true
            cleanup()
            notifications.getState().enqueue({
              kind: "warning",
              message: `Could not jump to ${match.path}:${match.line}`,
              durationMs: 4_000
            })
          }, JUMP_RETRY_MS)
          return
        }
        timer = window.setTimeout(attempt, JUMP_RETRY_MS)
      }

      attempt()
    }
  }))

  // The workspace store dispatches this after a successful switch (PD-14).
  if (typeof window !== "undefined") {
    window.addEventListener("leocode:workspace-switched", () => {
      store.getState().reset()
    })
  }

  return store
}
