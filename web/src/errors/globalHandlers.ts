import { errorMessage } from "./redact"

/**
 * Global safety nets, Task 12 + W-11. A failure that escapes React still reaches
 * the error surfaces instead of only the console.
 *
 * Three things this deliberately does:
 * - ignores Chromium's benign `ResizeObserver loop …` ErrorEvent, which fires
 *   around layout changes (the terminal fits itself on every resize) and would
 *   otherwise open a blocking "Something went wrong" sheet over the terminal;
 * - de-duplicates identical errors and caps a storm, so one broken loop cannot
 *   fill the sheet queue;
 * - keeps a re-entrancy guard, because a throw inside `report` would otherwise
 *   come back as a new window `error` and recurse.
 *
 * Errors reported before the store graph exists are kept by
 * [`createBootErrorQueue`] and reported once the stores mount, or shown by
 * `BootError` when the app never gets that far.
 */

/** Chromium's benign ResizeObserver ErrorEvent, matched on the message. */
export const BENIGN_ERROR =
  /ResizeObserver loop (?:completed with undelivered notifications|limit exceeded)/i

export const DEFAULT_DEDUPE_MS = 10_000
export const DEFAULT_MAX_REPORTS = 25

export interface GlobalHandlerOptions {
  /** Identical errors are reported at most once per window. */
  dedupeMs?: number
  /** Upper bound on distinct reports per window, as a storm guard. */
  maxReportsPerWindow?: number
  /** Injectable clock, for tests. */
  now?: () => number
  /** Where suppression notices go; defaults to `console.warn`. */
  log?: (message: string, detail?: unknown) => void
}

/** The ResizeObserver loop messages are not real failures. */
export function isBenignError(error: unknown): boolean {
  return BENIGN_ERROR.test(errorMessage(error))
}

export interface BootErrorQueue {
  /** Keep the error until the stores can surface it (latest `limit` only). */
  capture(error: unknown, context?: string): void
  /** Report everything buffered, oldest first; returns how many were sent. */
  flush(report: (error: unknown, context: string) => void): number
  readonly size: number
}

/**
 * Errors seen before `createAppStores` ran (the boot handshake, a module-level
 * throw). They are not console-only: the queue is flushed as soon as the error
 * store exists, or rendered by `BootError` when boot never completes.
 */
export function createBootErrorQueue(limit = 3): BootErrorQueue {
  let buffered: Array<{ error: unknown; context: string }> = []

  return {
    capture(error, context = "startup") {
      buffered.push({ error, context })
      if (buffered.length > limit) buffered = buffered.slice(-limit)
    },
    flush(report) {
      const pending = buffered
      buffered = []
      for (const item of pending) report(item.error, item.context)
      return pending.length
    },
    get size() {
      return buffered.length
    }
  }
}

export function installGlobalErrorHandlers(
  report: (error: unknown, context?: string) => void,
  options: GlobalHandlerOptions = {}
): () => void {
  const dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS
  const maxReports = options.maxReportsPerWindow ?? DEFAULT_MAX_REPORTS
  const now = options.now ?? (() => Date.now())
  const log = options.log ?? ((message: string) => console.warn(message))

  const seen = new Map<string, number>()
  let windowStart = now()
  let windowCount = 0
  let reporting = false

  const dispatch = (error: unknown, context: string) => {
    const message = errorMessage(error)
    if (isBenignError(message)) return

    const stamp = now()
    const key = `${context}\u0000${message}`
    const previous = seen.get(key)
    if (previous !== undefined && stamp - previous < dedupeMs) return
    if (seen.size > 64) {
      for (const [other, at] of seen) {
        if (stamp - at >= dedupeMs) seen.delete(other)
      }
    }
    seen.set(key, stamp)

    if (stamp - windowStart >= dedupeMs) {
      windowStart = stamp
      windowCount = 0
    }
    windowCount += 1
    if (windowCount > maxReports) {
      if (windowCount === maxReports + 1) {
        log(`[leocode] suppressing further errors for ${dedupeMs} ms`)
      }
      return
    }

    // A throw inside `report` arrives back here as a new window error; it must
    // not start another round.
    if (reporting) {
      log("[leocode] error reporter threw while reporting", message)
      return
    }
    reporting = true
    try {
      report(error, context)
    } catch (nested) {
      log("[leocode] error reporter threw", nested)
    } finally {
      reporting = false
    }
  }

  const onError = (event: ErrorEvent) => {
    // The ResizeObserver event has no `error` object, so check both.
    if (isBenignError(event.error) || isBenignError(event.message)) return
    dispatch(event.error ?? new Error(event.message), "window error")
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    if (isBenignError(event.reason)) return
    dispatch(event.reason, "unhandled promise rejection")
  }

  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
  return () => {
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
  }
}
