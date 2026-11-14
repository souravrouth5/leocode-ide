/**
 * Reporting hook for fire-and-forget bridge calls (W-23).
 *
 * `term.write`, `term.ack`, `term.resize`, `proc.cancel`, `runtime.cancel` and
 * theme updates are posted without awaiting a result: a caller cannot surface a
 * failure to the user without blocking input. Swallowing them entirely is worse
 * though — a terminal whose input never reaches the shell looks alive. This
 * helper reports the first failure of a burst and counts the rest, so a flood of
 * identical failures produces one notice instead of a hundred.
 */
export type BackgroundReport = (error: unknown, context: string) => void

export interface BackgroundReporterOptions {
  /** One report per context per window; the rest of the burst is counted. */
  windowMs?: number
  /** Injectable clock, for tests. */
  now?: () => number
}

export interface BackgroundErrorReporter {
  (error: unknown, context: string): void
  /** Failures suppressed since the last report for `context`. */
  suppressed(context: string): number
}

export const BACKGROUND_WINDOW_MS = 5_000

export function createBackgroundErrorReporter(
  report: BackgroundReport,
  options: BackgroundReporterOptions = {}
): BackgroundErrorReporter {
  const windowMs = options.windowMs ?? BACKGROUND_WINDOW_MS
  const now = options.now ?? (() => Date.now())
  const last = new Map<string, number>()
  const counts = new Map<string, number>()

  const reporter = ((error: unknown, context: string) => {
    const stamp = now()
    const previous = last.get(context)
    if (previous !== undefined && stamp - previous < windowMs) {
      counts.set(context, (counts.get(context) ?? 0) + 1)
      return
    }
    // Drop stale entries so a long session cannot grow the maps forever.
    for (const [key, at] of last) {
      if (stamp - at >= windowMs) last.delete(key)
    }
    last.set(context, stamp)
    counts.delete(context)
    try {
      report(error, context)
    } catch {
      // Reporting a background failure must never break the call that failed.
    }
  }) as BackgroundErrorReporter

  reporter.suppressed = (context: string) => counts.get(context) ?? 0
  return reporter
}
