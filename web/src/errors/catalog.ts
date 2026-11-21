import { AppError, type ErrorCode } from "../bridge/types"
import { redact } from "./redact"

/**
 * One entry per generated `ErrorCode`, `docs/bridge-contract.md` § Error codes
 * (Task 12). The catalog test fails if the Kotlin enum grows without copy.
 *
 * `surface` is where the UI shows the error:
 * - `snackbar` — transient, no decision required
 * - `banner`   — stays until dismissed; the pane keeps working
 * - `sheet`    — blocking explanation with one primary action
 */
export type ErrorSurface = "snackbar" | "banner" | "sheet"

export type ErrorActionKind = "retry" | "reload" | "dismiss"

export interface CatalogAction {
  label: string
  kind: ErrorActionKind
}

export interface CatalogEntry {
  title: string
  explanation: string
  surface: ErrorSurface
  severity: "info" | "warning" | "error"
  action: CatalogAction
}

const dismiss: CatalogAction = { label: "Dismiss", kind: "dismiss" }
const retry: CatalogAction = { label: "Try again", kind: "retry" }
const reload: CatalogAction = { label: "Reload", kind: "reload" }

export const ERROR_CATALOG: Record<ErrorCode, CatalogEntry> = {
  E_BAD_ENVELOPE: {
    title: "The app sent a malformed request",
    explanation:
      "This is a LeoCode bug, not something you did. Nothing on disk was changed. If it keeps happening, reopen the app.",
    surface: "sheet",
    severity: "error",
    action: dismiss
  },
  E_UNKNOWN_METHOD: {
    title: "This build does not support that action",
    explanation:
      "The page and the Android host disagree about the bridge version. Update LeoCode or reload the page.",
    surface: "sheet",
    severity: "error",
    action: reload
  },
  E_UNSUPPORTED: {
    title: "Not supported on this device",
    explanation:
      "The installed Android System WebView or the Android version does not provide this feature.",
    surface: "banner",
    severity: "warning",
    action: dismiss
  },
  E_TIMEOUT: {
    title: "The app took too long to answer",
    explanation:
      "The operation did not finish in time. It may still be running; try again in a moment.",
    surface: "banner",
    severity: "warning",
    action: retry
  },
  E_CANCELLED: {
    title: "Cancelled",
    explanation: "The operation was cancelled before it finished.",
    surface: "snackbar",
    severity: "info",
    action: dismiss
  },
  E_BRIDGE_DISCONNECTED: {
    title: "Lost connection to the app",
    explanation:
      "The Android host stopped answering. Running terminals and jobs may still be alive; reload to reconnect.",
    surface: "banner",
    severity: "error",
    action: reload
  },
  E_PATH_OUTSIDE_ROOT: {
    title: "That location is outside the workspace",
    explanation:
      "LeoCode only opens the active workspace and shared storage (while the storage permission is granted). Other paths stay closed for safety.",
    surface: "sheet",
    severity: "warning",
    action: dismiss
  },
  E_NOT_FOUND: {
    title: "Not found",
    explanation: "The file, folder, session or runtime is no longer there.",
    surface: "snackbar",
    severity: "warning",
    action: dismiss
  },
  E_NOT_DIR: {
    title: "That is not a folder",
    explanation: "A folder was expected at that path.",
    surface: "snackbar",
    severity: "warning",
    action: dismiss
  },
  E_EXISTS: {
    title: "Already exists",
    explanation: "A file or folder with that name is already there. Pick another name.",
    surface: "snackbar",
    severity: "warning",
    action: dismiss
  },
  E_BINARY: {
    title: "That file is not text",
    explanation:
      "The file is binary (an image, archive or bytecode), so the editor cannot open it safely.",
    surface: "banner",
    severity: "warning",
    action: dismiss
  },
  E_IO: {
    title: "Storage error",
    explanation:
      "Android refused the file operation. Check free space and permissions, then try again.",
    surface: "sheet",
    severity: "error",
    action: retry
  },
  E_DISK_FULL: {
    title: "The device is out of space",
    explanation:
      "Free some storage (or remove the trash and unused runtimes) and try again. Nothing was partially written.",
    surface: "sheet",
    severity: "error",
    action: dismiss
  },
  E_CONFLICT: {
    title: "The file changed on disk",
    explanation:
      "Another program or terminal changed this file after it was opened. Reload to take the disk version, or save to replace it.",
    surface: "banner",
    severity: "warning",
    action: reload
  },
  E_PERMISSION: {
    title: "Permission needed",
    explanation:
      "Android denied the request. Open Settings › Apps › LeoCode › Permissions to allow it, then try again.",
    surface: "sheet",
    severity: "warning",
    action: dismiss
  },
  E_LIMIT: {
    title: "Size limit reached",
    explanation:
      "The file or output is larger than this build allows in one operation.",
    surface: "snackbar",
    severity: "warning",
    action: dismiss
  },
  E_BUSY: {
    title: "Already running",
    explanation: "That operation is already in progress. Wait for it to finish.",
    surface: "snackbar",
    severity: "info",
    action: dismiss
  },
  E_NO_RUNTIME: {
    title: "Runtime not available",
    explanation:
      "The language runtime this action needs is not installed (or this build has no runtime package).",
    surface: "banner",
    severity: "warning",
    action: dismiss
  },
  E_OFFLINE: {
    title: "No network",
    explanation: "This action needs a connection. Check Wi-Fi or mobile data and try again.",
    surface: "banner",
    severity: "warning",
    action: retry
  },
  E_BAD_MANIFEST: {
    title: "Runtime package rejected",
    explanation:
      "The runtime package description is missing, out of date, or was not signed by LeoCode. Nothing was installed.",
    surface: "sheet",
    severity: "error",
    action: dismiss
  },
  E_INTEGRITY: {
    title: "Runtime package is damaged",
    explanation:
      "The download did not match its signed checksum, or the package contained an unsafe file. It was discarded; retry the install.",
    surface: "sheet",
    severity: "error",
    action: retry
  },
  E_HEALTH_CHECK: {
    title: "Runtime did not start",
    explanation:
      "The runtime was installed but did not pass its startup check, so the previous version was kept. Retry the install when the device is idle.",
    surface: "sheet",
    severity: "error",
    action: retry
  },
  E_AUTH: {
    title: "Authentication failed",
    explanation:
      "The remote service rejected the saved credential. Check the token or SSH key and try again.",
    surface: "sheet",
    severity: "error",
    action: dismiss
  },
  E_HOSTKEY_CHANGED: {
    title: "The server's host key changed",
    explanation:
      "This can mean the server was reinstalled — or that someone is intercepting the connection. LeoCode blocked the connection. Verify the host key before continuing.",
    surface: "sheet",
    severity: "error",
    action: dismiss
  },
  E_ROOT_UNAVAILABLE: {
    title: "Root is not available",
    explanation:
      "No root manager answered. Install or enable one (Magisk, KernelSU) and grant LeoCode access.",
    surface: "banner",
    severity: "warning",
    action: dismiss
  },
  E_ROOT_DENIED: {
    title: "Root access denied",
    explanation:
      "The root manager rejected the request. Grant access in the manager's Superuser screen, then try again.",
    surface: "banner",
    severity: "warning",
    action: dismiss
  },
  E_INTERNAL: {
    title: "Something went wrong",
    explanation:
      "LeoCode hit an unexpected problem. Nothing on disk was changed by the failed request. Copy the details if you want to report it.",
    surface: "sheet",
    severity: "error",
    action: dismiss
  }
}

export function catalogFor(code: ErrorCode): CatalogEntry {
  return ERROR_CATALOG[code]
}

/** Turn anything thrown into the typed error the catalog understands. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  if (error instanceof Error) return new AppError("E_INTERNAL", error.message)
  return new AppError("E_INTERNAL", String(error))
}

/** A short id that ties a user's "Copy details" text to one reported error. */
let correlationSeq = 0

export function nextCorrelationId(now: number = Date.now()): string {
  correlationSeq = (correlationSeq + 1) % 0x1_0000
  return `lc-${now.toString(36)}-${correlationSeq.toString(36)}`
}

export interface ErrorDetailsOptions {
  /** `app.info` version, when the shell already knows it. */
  version?: string
  /** Set by `errorsStore.report` so a report can be matched to a surface. */
  correlationId?: string
  /** Injectable clock, for tests. */
  when?: Date
}

/**
 * Text for the sheet's "Copy details" action. Secrets, URL credentials and
 * absolute app paths are masked (W-09); the message never carries a stack.
 */
export function errorDetails(
  error: AppError,
  context?: string,
  options: ErrorDetailsOptions = {}
): string {
  const entry = catalogFor(error.code)
  return [
    `LeoCode error: ${error.code}`,
    `Title: ${entry.title}`,
    `Message: ${redact(error.message)}`,
    context ? `During: ${redact(context)}` : null,
    `When: ${(options.when ?? new Date()).toISOString()}`,
    `Surface: ${entry.surface}`,
    `Version: ${options.version ?? "unknown"}`,
    `Correlation: ${options.correlationId ?? "unknown"}`
  ]
    .filter((line): line is string => line !== null)
    .join("\n")
}
