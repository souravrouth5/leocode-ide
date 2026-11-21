import { copyText } from "./clipboard"
import { redact } from "./redact"

interface PaneErrorProps {
  title?: string
  error: Error
  onRetry: () => void
  onNotice?: (message: string) => void
}

/**
 * Fallback for a crashed pane: the rest of the IDE keeps working.
 *
 * A render error can embed anything a dependency printed, so the text and the
 * copied details are redacted (W-09).
 */
export function PaneError({ title = "This panel crashed", error, onRetry, onNotice }: PaneErrorProps) {
  const message = redact(error.message)
  return (
    <div className="pane-error" role="alert">
      <div className="pane-error-mark">!</div>
      <h3>{title}</h3>
      <p>{message}</p>
      <div className="pane-error-actions">
        <button className="btn primary" onClick={onRetry}>
          Try again
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            void copyText(redact(`${error.name}: ${error.message}`)).then((copied) =>
              onNotice?.(copied ? "Details copied" : "Could not copy details")
            )
          }}
        >
          Copy details
        </button>
      </div>
    </div>
  )
}

interface CrashScreenProps {
  error: Error
  onReload: () => void
  onNotice?: (message: string) => void
}

/** App-level fallback: the whole UI failed to render, so offer a clean reload. */
export function CrashScreen({ error, onReload, onNotice }: CrashScreenProps) {
  return (
    <div className="crash-screen" role="alert">
      <div className="crash-mark">LeoCode</div>
      <h1>LeoCode stopped responding</h1>
      <p>
        The interface hit an unexpected problem. Your files and workspace on disk are
        unchanged.
      </p>
      <pre className="crash-message">{redact(error.message)}</pre>
      <div className="crash-actions">
        <button className="btn primary" onClick={onReload}>
          Reload LeoCode
        </button>
        <button
          className="btn ghost"
          onClick={() => {
            void copyText(redact(`${error.name}: ${error.message}`)).then((copied) =>
              onNotice?.(copied ? "Details copied" : "Could not copy details")
            )
          }}
        >
          Copy details
        </button>
      </div>
    </div>
  )
}
