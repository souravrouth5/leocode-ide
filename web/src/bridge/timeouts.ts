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
  "fs.stat",
  "draft.list",
  "draft.read",
  "workspace.list",
  "storage.info",
  "term.list",
  // Phase F: Git reads may be retried; writes, network ops and SSH mutations
  // never are (a retried commit/push would duplicate work).
  "git.status",
  "git.diff",
  "git.log",
  "git.branch.list",
  "git.remote.list"
])

/** Long Git network operations are progress-driven and cancelled by op id. */
const GIT_NETWORK_METHODS = new Set([
  "git.clone",
  "git.fetch",
  "git.pull",
  "git.push"
])

/** Non-idempotent Git/SSH/secrets reads: quick, but never retried. */
const READ_METHODS = new Set([
  "ssh.keys.list",
  "ssh.hostkey.list",
  "secrets.token.list"
])

export function defaultTimeoutMs(method: string): number | null {
  if (USER_WAIT_METHODS.has(method) || method.startsWith("saf.")) return null
  // The host replies when an install finishes, not on start, so a fixed timeout
  // would abort every real install (B-03/W-01). Cancellation is runtime.cancel.
  if (method === "runtime.install") return null
  // A Git clone/fetch/pull/push runs until it finishes; the reply is the result,
  // not a start ack. Progress arrives meanwhile and `git.cancel` stops it.
  if (GIT_NETWORK_METHODS.has(method)) return null
  // Cancelling is a small control message even while its search is running.
  if (method === "fs.search.cancel" || method === "git.cancel") return 2_000
  // A broad workspace search is capped but still walks many files (Task 16).
  if (method === "fs.search") return 60_000
  if (
    method === "fs.write" ||
    method === "draft.save" ||
    method === "draft.delete" ||
    method.startsWith("workspace.")
  ) {
    return WRITE_TIMEOUT_MS
  }
  if (READ_METHODS.has(method) || IDEMPOTENT_READS.has(method)) return FAST_TIMEOUT_MS
  if (method.startsWith("git.") || method.startsWith("ssh.") || method.startsWith("secrets.")) {
    return WRITE_TIMEOUT_MS
  }
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
