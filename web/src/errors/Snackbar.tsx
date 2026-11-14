import { useEffect } from "react"
import { XIcon } from "../components/Icons"
import type { Notice } from "../notifications/notificationsStore"

interface SnackbarProps {
  notice: Notice | null
  onDismiss: (id: string) => void
}

/** One snackbar at a time; the notifications store supplies the queue. */
export function Snackbar({ notice, onDismiss }: SnackbarProps) {
  useEffect(() => {
    if (!notice || notice.durationMs === null) return
    const timer = window.setTimeout(() => onDismiss(notice.id), notice.durationMs)
    return () => window.clearTimeout(timer)
  }, [notice, onDismiss])

  if (!notice) return null

  return (
    <div className={`snackbar ${notice.kind}`} role="status" aria-live="polite">
      <div className="snackbar-text">
        <span className="snackbar-message">{notice.message}</span>
        {notice.detail && <span className="snackbar-detail">{notice.detail}</span>}
      </div>
      {notice.action && (
        <button
          className="snackbar-action"
          onClick={() => {
            notice.action?.run()
            onDismiss(notice.id)
          }}
        >
          {notice.action.label}
        </button>
      )}
      <button
        className="snackbar-close"
        onClick={() => onDismiss(notice.id)}
        aria-label="Dismiss notification"
      >
        <XIcon size={14} />
      </button>
    </div>
  )
}
