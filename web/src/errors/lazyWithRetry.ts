import { lazy, type ComponentType } from "react"

const RETRY_KEY = "leocode.chunk-retry"

/**
 * Lazy pane with one recovery attempt for a stale hashed chunk after the APK's
 * web assets changed. A second failure propagates to the ErrorBoundary.
 */
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const module = await factory()
      try {
        // The retry budget is per failure, not per tab session: a successful
        // load re-arms it for the next deploy (W-35).
        sessionStorage.removeItem(RETRY_KEY)
      } catch {
        // Storage can be blocked; the pane still works.
      }
      return module
    } catch (error) {
      try {
        if (sessionStorage.getItem(RETRY_KEY) !== "1") {
          sessionStorage.setItem(RETRY_KEY, "1")
          location.reload()
        }
      } catch {
        // Storage can be blocked; the boundary shows the failure instead.
      }
      throw error
    }
  })
}
