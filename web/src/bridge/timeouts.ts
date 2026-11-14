/**
 * Client-side request policy, `docs/bridge-contract.md` § Timeouts (Task 11).
 *
 * Streamed methods get a timeout for their *reply on start* only; the events that
 * follow are not time-limited. User-driven methods (SAF pickers, permission
 * prompts) have no default timeout and are cancelled by the caller.
 */

export const FAST_TIMEOUT_MS = 10_000
export const WRITE_TIMEOUT_MS = 20_000

export interface RequestOptions {
  /** Cancel the request; the promise rejects with `E_CANCELLED`. */
  signal?: AbortSignal
  /** Override the default timeout. `null` disables it for this call. */
  timeoutMs?: number | null
}

const USER_WAIT_METHODS = new Set([
  "storage.requestPermission",
  "root.request",
  "ssh.hostkey.answer"
])

const IDEMPOTENT_READS = new Set([
  "app.info",
  "app.theme.get",
  "fs.list",
  "fs.read",
  "storage.info",
  "term.list"
])

export function defaultTimeoutMs(method: string): number | null {
  if (USER_WAIT_METHODS.has(method) || method.startsWith("saf.")) return null
  // The host replies when an install finishes, not on start, so a fixed timeout
  // would abort every real install (B-03/W-01). Cancellation is runtime.cancel.
  if (method === "runtime.install") return null
  if (method === "fs.write" || method.startsWith("workspace.")) return WRITE_TIMEOUT_MS
  return FAST_TIMEOUT_MS
}

/** Reads may be retried once after a timeout; writes and streams may not. */
export function isIdempotentRead(method: string): boolean {
  return IDEMPOTENT_READS.has(method)
}

export function timeoutMsFor(method: string, options?: RequestOptions): number | null {
  if (options && options.timeoutMs !== undefined) return options.timeoutMs
  return defaultTimeoutMs(method)
}
