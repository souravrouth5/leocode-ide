import { createStore, type StoreApi } from "zustand/vanilla"

/**
 * In-app confirm/prompt dialogs (PD-02).
 *
 * Android WebView cancels unhandled JS dialogs, so `window.confirm` always
 * returns false and `window.prompt` always returns null on device. Every
 * destructive action and every text prompt goes through this store instead; the
 * `DialogHost` component renders the request with the existing sheet styling.
 */

export interface ConfirmDialogOptions {
  title?: string
  message: string
  detail?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as destructive. */
  danger?: boolean
}

export interface PromptDialogOptions {
  title: string
  label?: string
  initial?: string
  placeholder?: string
  confirmLabel?: string
  cancelLabel?: string
  /** Mask the input (passphrases, tokens). */
  secret?: boolean
  /** Keep leading/trailing spaces; defaults to trimming the value. */
  trim?: boolean
  /**
   * Return an error string to keep the dialog open with an inline message;
   * `null` accepts the trimmed value.
   */
  validate?: (value: string) => string | null
}

export interface ConfirmRequest {
  kind: "confirm"
  id: number
  options: ConfirmDialogOptions
  resolve: (value: boolean) => void
}

export interface PromptRequest {
  kind: "prompt"
  id: number
  options: PromptDialogOptions
  resolve: (value: string | null) => void
}

export type DialogRequest = ConfirmRequest | PromptRequest

export interface DialogState {
  /** The dialog currently on screen, or null when none is open. */
  request: DialogRequest | null
  confirm(options: ConfirmDialogOptions): Promise<boolean>
  prompt(options: PromptDialogOptions): Promise<string | null>
  /** Answer the open confirm dialog with "yes". */
  accept(): void
  /** Answer the open prompt dialog with [value] (already trimmed by the host). */
  answer(value: string): void
  /** Dismiss the open dialog: confirm resolves false, prompt resolves null. */
  cancel(): void
}

export function createDialogStore(): StoreApi<DialogState> {
  const queue: DialogRequest[] = []
  let nextId = 1

  const store = createStore<DialogState>((set, get) => ({
    request: null,

    confirm(options) {
      return new Promise<boolean>((resolve) => {
        queue.push({ kind: "confirm", id: nextId++, options, resolve })
        showNext()
      })
    },

    prompt(options) {
      return new Promise<string | null>((resolve) => {
        queue.push({ kind: "prompt", id: nextId++, options, resolve })
        showNext()
      })
    },

    accept() {
      const request = get().request
      if (!request || request.kind !== "confirm") return
      settle(request, true)
    },

    answer(value) {
      const request = get().request
      if (!request || request.kind !== "prompt") return
      settle(request, value)
    },

    cancel() {
      const request = get().request
      if (!request) return
      settle(request, request.kind === "confirm" ? false : null)
    }
  }))

  function showNext(): void {
    if (store.getState().request !== null) return
    const next = queue.shift()
    if (next) store.setState({ request: next })
  }

  function settle(request: DialogRequest, value: boolean | string | null): void {
    // Only settle the request that is actually on screen; a stray key press
    // must not resolve the next queued dialog.
    if (store.getState().request !== request) return
    store.setState({ request: null })
    if (request.kind === "confirm") request.resolve(value === true)
    else request.resolve(typeof value === "string" ? value : null)
    showNext()
  }

  return store
}
