import { useEffect, useState } from "react"
import type { Bridge } from "../../bridge"
import { Sheet } from "../../components/Sheet"
import { copyText } from "../../errors/clipboard"
import type { ActiveError } from "../../errors/errorsStore"
import { redact } from "../../errors/redact"

interface Props {
  open: boolean
  onClose: () => void
  bridge: Bridge
  recentErrors: ActiveError[]
  version: string
  onNotice: (message: string) => void
}

const formatError = (active: ActiveError): string => {
  const when = active.at ? new Date(active.at).toISOString() : "unknown time"
  const context = active.context ? ` during ${active.context}` : ""
  const correlation = active.correlationId ? ` [${active.correlationId}]` : ""
  return `  ${when} ${active.error.code}${context}${correlation}: ${redact(active.error.message)}`
}

/**
 * Settings › About › Diagnostics (Task 27).
 *
 * The native half is already redacted by `core/Diagnostics.kt`; the web half
 * appends the recent error ring with the same `redact()` used by every error
 * surface. Copy and Share send exactly the text shown, never a raw path.
 */
export function DiagnosticsSheet({
  open,
  onClose,
  bridge,
  recentErrors,
  version,
  onNotice
}: Props) {
  const [report, setReport] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setReport(null)
    setFailed(null)
    void bridge
      .diagnostics()
      .then((next) => {
        if (!cancelled) setReport(next)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFailed(redact(error instanceof Error ? error.message : String(error)))
        }
      })
    return () => {
      cancelled = true
    }
  }, [bridge, open])

  const text = (() => {
    const header = [`LeoCode diagnostics (app ${version})`]
    const recent =
      recentErrors.length === 0
        ? ["Recent errors:", "  none"]
        : ["Recent errors:", ...recentErrors.map(formatError)]
    const native = report ? [report] : failed ? [`Native report unavailable: ${failed}`] : ["Loading…"]
    return redact([...header, "", ...native, "", ...recent].join("\n"))
  })()

  const share = async () => {
    // Android has no Web Share API in its WebView: `app.share` opens the system
    // chooser. Mock mode returns false and the browser path below runs instead.
    const shared = await bridge.shareText(text).catch(() => false)
    if (shared) {
      onNotice("Diagnostics shared")
      return
    }
    if (navigator.share) {
      try {
        await navigator.share({ title: "LeoCode diagnostics", text })
        return
      } catch (error) {
        // A cancelled share is not a failure; fall through only on real errors.
        if (error instanceof DOMException && error.name === "AbortError") return
      }
    }
    onNotice((await copyText(text)) ? "Diagnostics copied" : "Could not copy diagnostics")
  }

  return (
    <Sheet open={open} onClose={onClose} title="Diagnostics">
      <div className="diagnostics-sheet">
        <p className="guide-intro">
          Redacted support data: device, WebView, storage, runtimes and recent errors. Paths
          and credentials are removed before the text leaves LeoCode.
        </p>
        <pre className="diagnostics-report" aria-live="polite">
          {text}
        </pre>
        <div className="diagnostics-actions">
          <button
            className="btn ghost"
            disabled={report === null && failed === null}
            onClick={() => {
              void copyText(text).then((copied) =>
                onNotice(copied ? "Diagnostics copied" : "Could not copy diagnostics")
              )
            }}
          >
            Copy
          </button>
          <button className="btn primary" onClick={() => void share()}>
            Share
          </button>
        </div>
      </div>
    </Sheet>
  )
}
