import type { ReactNode } from "react"
import { XIcon } from "../components/Icons"

interface InlineBannerProps {
  title: string
  message?: string
  tone?: "info" | "warning" | "error"
  actionLabel?: string
  onAction?: () => void
  onDismiss?: () => void
  children?: ReactNode
}

/** A recoverable problem: the pane keeps working while the banner stays. */
export function InlineBanner({
  title,
  message,
  tone = "warning",
  actionLabel,
  onAction,
  onDismiss,
  children
}: InlineBannerProps) {
  return (
    <div
      className={`inline-banner ${tone}`}
      role={tone === "info" ? "status" : "alert"}
    >
      <div className="inline-banner-text">
        <strong>{title}</strong>
        {message && <span>{message}</span>}
        {children}
      </div>
      {actionLabel && onAction && (
        <button className="btn ghost small" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {onDismiss && (
        <button
          className="icon-btn inline-banner-close"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <XIcon size={14} />
        </button>
      )}
    </div>
  )
}
