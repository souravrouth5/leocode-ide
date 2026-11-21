import { Sheet } from "../components/Sheet"
import { copyText } from "./clipboard"
import { errorDetails } from "./catalog"
import { redact } from "./redact"
import type { ActiveError } from "./errorsStore"

interface ErrorSheetProps {
  active: ActiveError | null
  onClose: () => void
  onNotice?: (message: string) => void
  /** `app.info` version, included in Copy details (W-09). */
  version?: string
  /**
   * Ask Android for shared-storage access (W-27). Shown for the permission and
   * path errors, which are the ones a grant can actually fix.
   */
  onRequestStoragePermission?: () => void
}

/** Errors whose only real fix is granting storage access. */
const PERMISSION_CODES = new Set(["E_PERMISSION", "E_PATH_OUTSIDE_ROOT"])

/**
 * Blocking explanation for errors the user must understand (disk full, path
 * jail, internal failure). One primary action; details can be copied.
 *
 * The raw host message is redacted before it is rendered: it can carry a token,
 * a URL password or an absolute app path (W-09).
 */
export function ErrorSheet({
  active,
  onClose,
  onNotice,
  version,
  onRequestStoragePermission
}: ErrorSheetProps) {
  if (!active) return null
  const { entry, error, context, retry } = active
  const message = error.message ? redact(error.message) : ""

  const primary =
    entry.action.kind === "retry" && retry
      ? { label: entry.action.label, run: retry }
      : entry.action.kind === "reload"
        ? { label: entry.action.label, run: () => location.reload() }
        : null

  const canGrant = onRequestStoragePermission && PERMISSION_CODES.has(error.code)

  return (
    <Sheet open onClose={onClose} title={entry.title}>
      <div className="error-sheet">
        <p className="error-explanation">{entry.explanation}</p>
        {message && <pre className="error-message">{message}</pre>}
        {context && <p className="error-context">During: {redact(context)}</p>}
        <div className="error-actions">
          {primary && (
            <button
              className="btn primary"
              onClick={() => {
                onClose()
                primary.run()
              }}
            >
              {primary.label}
            </button>
          )}
          {canGrant && (
            <button
              className="btn primary"
              onClick={() => {
                onClose()
                onRequestStoragePermission()
              }}
            >
              Grant storage access
            </button>
          )}
          <button
            className="btn ghost"
            onClick={() => {
              void copyText(
                errorDetails(error, context, {
                  version,
                  correlationId: active.correlationId
                })
              ).then((copied) =>
                onNotice?.(
                  copied ? "Error details copied" : "Could not copy error details"
                )
              )
            }}
          >
            Copy details
          </button>
          {!primary && (
            <button className="btn ghost" onClick={onClose}>
              Dismiss
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
