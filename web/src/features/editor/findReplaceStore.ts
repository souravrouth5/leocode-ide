import { createStore, type StoreApi } from "zustand/vanilla"
import { WORKSPACE_SWITCHED_EVENT } from "../workspace/workspaceEvents"
import { editorCommand } from "./commands"

export interface FindReplaceState {
  open: boolean
  query: string
  replacement: string
  caseSensitive: boolean
  regexp: boolean
  openSheet(initial?: string): void
  close(): void
  setQuery(query: string): void
  setReplacement(replacement: string): void
  setCaseSensitive(value: boolean): void
  setRegexp(value: boolean): void
  findNext(): void
  replaceNext(): void
  replaceAll(): void
  /** Forget every term and close the sheet (workspace switch, PD-14). */
  reset(): void
}

export type FindReplaceStore = StoreApi<FindReplaceState> & {
  /** Remove the window listener this store installed. */
  dispose(): void
}

const RESET = {
  open: false,
  query: "",
  replacement: "",
  caseSensitive: false,
  regexp: false
} as const

/**
 * Find/replace sheet state (Task 15). The query is sent to the active CodeMirror
 * pane as an editor command; the pane owns selection and undo history.
 *
 * Terms belong to the workspace they were typed in, so a switch clears them
 * instead of searching the new root for the old query (PD-14).
 */
export function createFindReplaceStore(): FindReplaceStore {
  const store = createStore<FindReplaceState>((set, get) => ({
    ...RESET,

    openSheet(initial) {
      set((state) => ({
        open: true,
        query: initial ?? state.query
      }))
    },

    close() {
      set({ open: false })
    },

    setQuery(query) {
      set({ query })
    },

    setReplacement(replacement) {
      set({ replacement })
    },

    setCaseSensitive(caseSensitive) {
      set({ caseSensitive })
    },

    setRegexp(regexp) {
      set({ regexp })
    },

    findNext() {
      dispatch("findNext", get())
    },

    replaceNext() {
      dispatch("replaceNext", get())
    },

    replaceAll() {
      dispatch("replaceAll", get())
    },

    reset() {
      set({ ...RESET })
    }
  }))

  const onWorkspaceSwitched = () => store.getState().reset()
  if (typeof window !== "undefined") {
    window.addEventListener(WORKSPACE_SWITCHED_EVENT, onWorkspaceSwitched)
  }

  const api = store as FindReplaceStore
  api.dispose = () => {
    if (typeof window !== "undefined") {
      window.removeEventListener(WORKSPACE_SWITCHED_EVENT, onWorkspaceSwitched)
    }
  }

  function dispatch(
    action: "findNext" | "replaceNext" | "replaceAll",
    state: FindReplaceState
  ): void {
    if (!state.query) return
    editorCommand(action, {
      query: state.query,
      replacement: state.replacement,
      caseSensitive: state.caseSensitive,
      regexp: state.regexp
    })
  }

  return api
}
