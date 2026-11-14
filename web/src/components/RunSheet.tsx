import { useEffect, useRef } from "react"
import { Sheet } from "./Sheet"
import { StopIcon } from "./Icons"
import { redact } from "../errors/redact"

export interface RunSegment {
  stream: "stdout" | "stderr"
  text: string
}

interface Props {
  open: boolean
  title: string
  running: boolean
  exitCode: number | null
  segments: RunSegment[]
  hint?: string | null
  onStop: () => void
  onClose: () => void
}

export function RunSheet({
  open,
  title,
  running,
  exitCode,
  segments,
  hint,
  onStop,
  onClose
}: Props) {
  const output = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    const node = output.current
    if (!node) return
    // Only stick to the bottom when the user has not scrolled up.
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 80
    if (nearBottom) node.scrollTop = node.scrollHeight
  }, [segments])

  const started = running || exitCode !== null

  // A failing run puts the host message here, so redact it like every other
  // user-visible message sink (W-09).
  const safeHint = hint ? redact(hint) : null

  const status = running
    ? "running"
    : exitCode === null
      ? "not run"
      : exitCode === 0
        ? "exit 0"
        : `exit ${exitCode}`

  const tone = running || exitCode === 0 ? "pty" : exitCode === null ? "" : "closed"

  return (
    <Sheet open={open} onClose={onClose} title={`Run · ${title}`}>
      <div className="run">
        <div className="run-bar">
          <span className={"term-status" + (tone ? " " + tone : "")}>{status}</span>
          <span className="run-note">
            {running
              ? "streaming output…"
              : started
                ? "output is not saved automatically"
                : ""}
          </span>
        </div>

        {(running || segments.length > 0) && (
          <pre className="run-output" ref={output}>
            {segments.length === 0 && running ? "…" : null}
            {segments.map((segment, index) => (
              <span key={index} className={segment.stream}>
                {segment.text}
              </span>
            ))}
          </pre>
        )}

        {safeHint && <p className="run-hint">{safeHint}</p>}

        <div className="run-actions">
          {running ? (
            <button className="btn primary" onClick={onStop}>
              <StopIcon size={16} />
              Stop
            </button>
          ) : (
            <button className="btn ghost" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
