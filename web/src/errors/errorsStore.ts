import { createStore, type StoreApi } from "zustand/vanilla"
import type { Notice } from "../notifications/notificationsStore"
import {
  catalogFor,
  nextCorrelationId,
  toAppError,
  type CatalogEntry
} from "./catalog"
import { redact } from "./redact"
import type { AppError } from "../bridge/types"

export interface ActiveError {
  error: AppError
  entry: CatalogEntry
  context?: string
  /** Ties the surface the user saw to its "Copy details" text (W-09). */
  correlationId?: string
  /** Re-run the failed operation, when the caller can offer it. */
  retry?: () => void
}

export interface ReportOptions {
  /** Human-readable operation name, for Copy details. */
  context?: string
  retry?: () => void
}

export interface ErrorsState {
  banner: ActiveError | null
  sheet: ActiveError | null
  report(error: unknown, options?: ReportOptions): ActiveError
  dismissBanner(): void
  dismissSheet(): void
  dismissAll(): void
}

export type Notify = (notice: Omit<Notice, "id">) => void

/**
 * Routes an error to the surface its catalog entry names (Task 12):
 * snackbar for transient problems, banner for recoverable ones, sheet when the
 * user has to read an explanation. Every catch in the UI reports here instead of
 * silently swallowing.
 *
 * The message is only redacted at the surface, so the original stays available
 * for surface selection and for `errorDetails`, which does its own masking.
 */
export function createErrorsStore(notify: Notify): StoreApi<ErrorsState> {
  return createStore<ErrorsState>((set) => ({
    banner: null,
    sheet: null,

    report(error, options) {
      const appError = toAppError(error)
      const entry = catalogFor(appError.code)
      const active: ActiveError = {
        error: appError,
        entry,
        context: options?.context,
        correlationId: nextCorrelationId(),
        retry: options?.retry
      }

      if (entry.surface === "snackbar") {
        notify({
          kind: entry.severity === "info" ? "info" : "warning",
          message: entry.title,
          detail: redact(appError.message),
          durationMs: 5_000
        })
      } else if (entry.surface === "banner") {
        set({ banner: active })
      } else {
        set({ sheet: active })
      }
      return active
    },

    dismissBanner() {
      set({ banner: null })
    },

    dismissSheet() {
      set({ sheet: null })
    },

    dismissAll() {
      set({ banner: null, sheet: null })
    }
  }))
}
