import { createStore, type StoreApi } from "zustand/vanilla"
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
}

/**
 * Find/replace sheet state (Task 15). The query is sent to the active CodeMirror
 * pane as an editor command; the pane owns selection and undo history.
 */
export function createFindReplaceStore(): StoreApi<FindReplaceState> {
  return createStore<FindReplaceState>((set, get) => ({
    open: false,
    query: "",
    replacement: "",
    caseSensitive: false,
    regexp: false,

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
    }
  }))

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
}
