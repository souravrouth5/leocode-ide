import { Sheet } from "../components/Sheet"
import { copyText } from "./clipboard"
import { errorDetails } from "./catalog"
import type { ActiveError } from "./errorsStore"

interface ErrorSheetProps {
  active: ActiveError | null
  onClose: () => void
  onNotice?: (message: string) => void
}

/**
 * Blocking explanation for errors the user must understand (disk full, path
 * jail, internal failure). One primary action; details can be copied.
 */
export function ErrorSheet({ active, onClose, onNotice }: ErrorSheetProps) {
  if (!active) return null
  const { entry, error, context, retry } = active

  const primary =
    entry.action.kind === "retry" && retry
      ? { label: entry.action.label, run: retry }
      : entry.action.kind === "reload"
        ? { label: entry.action.label, run: () => location.reload() }
        : null

  return (
    <Sheet open onClose={onClose} title={entry.title}>
      <div className="error-sheet">
        <p className="error-explanation">{entry.explanation}</p>
        {error.message && <pre className="error-message">{error.message}</pre>}
        {context && <p className="error-context">During: {context}</p>}
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
          <button
            className="btn ghost"
            onClick={() => {
              void copyText(errorDetails(error, context)).then((copied) =>
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
