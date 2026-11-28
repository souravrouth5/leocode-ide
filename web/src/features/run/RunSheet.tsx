import { useEffect, useRef, useState } from "react"
import { useStore } from "zustand"
import type { StoreApi } from "zustand/vanilla"
import { Sheet } from "../../components/Sheet"
import { StopIcon } from "../../components/Icons"
import { redact } from "../../errors/redact"
import { editorCommand } from "../editor/commands"
import type { RootState } from "../root/rootStore"
import type { RunStore } from "./runStore"
import {
  parseTraceback,
  isInsideWorkspace,
  toWorkspacePath,
  type ErrorSummary,
  type ParsedTraceback
} from "./traceback"
import { useStores } from "../../app/stores"

export interface RunSegment {
  stream: "stdout" | "stderr"
  text: string
}

export interface RunSheetProps {
  open: boolean
  title: string
  running: boolean
  exitCode: number | null
  segments: RunSegment[]
  hint?: string | null
  durationMs?: number | null
  errorSummary?: ErrorSummary | null
  traceback?: ParsedTraceback | null
  workspaceRoot?: string
  rootLost?: boolean
  isRoot?: boolean
  onStop: () => void
  onClose: () => void
  onSendInput?: (text: string) => void
  onJumpToFile?: (file: string, line: number) => void
  onRetryRoot?: () => void
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function useOptionalStores() {
  try {
    return useStores()
  } catch {
    return null
  }
}

function useRunStoreState(stores: ReturnType<typeof useOptionalStores>) {
  const run = stores?.run
  const [state, setState] = useState(() => run?.getState().run ?? null)
  useEffect(() => {
    if (!run) return
    setState(run.getState().run)
    return run.subscribe((next) => setState(next.run))
  }, [run])
  return state
}

export function RunSheet({
  open,
  title,
  running,
  exitCode,
  segments,
  hint,
  durationMs: propDurationMs,
  errorSummary: propErrorSummary,
  traceback: propTraceback,
  workspaceRoot,
  rootLost: propRootLost,
  isRoot: propIsRoot,
  onStop,
  onClose,
  onSendInput,
  onJumpToFile,
  onRetryRoot
}: RunSheetProps) {
  const output = useRef<HTMLPreElement | null>(null)
  const [stdinText, setStdinText] = useState("")
  const stores = useOptionalStores()
  const runState = useRunStoreState(stores)
  const wsState = stores?.workspace?.getState()
  const effectiveWorkspaceRoot =
    workspaceRoot ??
    wsState?.workspaces.find((w) => w.id === wsState.activeId)?.path ??
    undefined
  const isRootLost = propRootLost !== undefined ? propRootLost : runState?.rootLost ?? false
  const isRootActive =
    running &&
    (propIsRoot !== undefined
      ? propIsRoot
      : stores?.run
        ? stores.run.getState().runAsRoot
        : false)

  const durationMs = propDurationMs !== undefined ? propDurationMs : runState?.durationMs
  const traceback = propTraceback !== undefined ? propTraceback : runState?.traceback
  const errorSummary =
    propErrorSummary !== undefined
      ? propErrorSummary
      : runState?.errorSummary ??
        traceback?.error ??
        (segments.length > 0
          ? parseTraceback(segments.map((s) => s.text).join(""), effectiveWorkspaceRoot).error
          : null)

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
    : durationMs !== null && durationMs !== undefined
      ? exitCode !== null
        ? `Finished in ${formatDuration(durationMs)} (exit ${exitCode})`
        : started
          ? `Finished in ${formatDuration(durationMs)} (stopped)`
          : "not run"
      : exitCode === null
        ? "not run"
        : exitCode === 0
          ? "exit 0"
          : `exit ${exitCode}`

  const tone = running || exitCode === 0 ? "pty" : exitCode === null ? "" : "closed"

  const handleJump = (file: string, line: number) => {
    if (onJumpToFile) {
      onJumpToFile(file, line)
      return
    }
    if (stores?.run) {
      void stores.run.getState().jumpToFile(file, line)
      stores.run.getState().hide()
      stores.shell?.getState().go("editor")
    } else if (stores?.editor) {
      void stores.editor.getState().openFile(file)
      stores.shell?.getState().go("editor")
      editorCommand("gotoLine", line)
      editorCommand("gotoPosition", { line, col: 1 })
    }
  }

  const handleSendInput = (text: string) => {
    if (onSendInput) {
      onSendInput(text)
    } else if (stores?.run) {
      stores.run.getState().sendInput(text)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={`Run · ${title}`}>
      <div className="run-panel">
        <div className="run-bar">
          <span className={"term-status" + (tone ? " " + tone : "")}>{status}</span>
          {isRootActive && (
            <span
              className="badge root-badge"
              title="Process running as superuser (root / UID 0)"
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: "var(--color-danger, #ef4444)",
                color: "#ffffff",
                padding: "2px 5px",
                borderRadius: 3,
                letterSpacing: 0.5
              }}
            >
              # ROOT
            </span>
          )}
          <span className="run-note">
            {running
              ? "streaming output…"
              : started
                ? "output is not saved automatically"
                : ""}
          </span>
          {stores?.root && stores?.run && (
            <RunRootControls rootStore={stores.root} runStore={stores.run} running={running} />
          )}
        </div>

        {isRootLost && (
          <div
            className="run-lost-banner"
            role="alert"
            style={{
              padding: "8px 12px",
              background: "var(--color-danger-subtle, rgba(239, 68, 68, 0.15))",
              borderBottom: "1px solid var(--color-danger, #ef4444)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              fontSize: 12
            }}
          >
            <span>Root access was refused. The process ended.</span>
            <button
              className="btn tiny primary"
              onClick={() => {
                if (onRetryRoot) onRetryRoot()
                else void stores?.run.getState().runFile()
              }}
            >
              Try again
            </button>
          </div>
        )}

        {errorSummary && (
          <div className="run-error-summary" role="alert" data-testid="run-error-summary">
            <div className="run-error-header">
              <span className="run-error-badge">{errorSummary.type}</span>{" "}
              <strong className="run-error-title">{errorSummary.title}</strong>
            </div>
            <p className="run-error-desc">{errorSummary.description}</p>
            {errorSummary.action && (
              <div className="run-error-action">
                <span className="run-error-label">Suggestion:</span>{" "}
                <code className="run-error-command">{errorSummary.action.label}</code>
              </div>
            )}
          </div>
        )}

        {(running || segments.length > 0) && (
          <pre className="run-output" ref={output}>
            {segments.length === 0 && running ? "…" : null}
            {segments.map((segment, segIdx) => (
              <span key={segIdx} className={segment.stream}>
                {renderSegmentText(segment.text, effectiveWorkspaceRoot, handleJump)}
              </span>
            ))}
          </pre>
        )}

        {running && (
          <form
            className="run-stdin-row"
            onSubmit={(event) => {
              event.preventDefault()
              if (!stdinText.trim()) return
              handleSendInput(stdinText)
              setStdinText("")
            }}
          >
            <input
              type="text"
              className="run-stdin-input"
              placeholder="Send input to process (stdin)…"
              value={stdinText}
              onChange={(e) => setStdinText(e.target.value)}
              aria-label="Process stdin"
            />
            <button
              type="submit"
              className="btn primary run-stdin-send"
              disabled={!stdinText.trim()}
            >
              Send
            </button>
          </form>
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

function RunRootControls({
  rootStore,
  runStore,
  running
}: {
  rootStore: StoreApi<RootState>
  runStore: RunStore
  running: boolean
}) {
  const rootEnabled = useStore(rootStore, (s) => s.enabled)
  const runAsRoot = useStore(runStore, (s) => s.runAsRoot)
  if (!rootEnabled) return null
  return (
    <label
      className="run-root-toggle"
      title="Execute script with root (su) privileges"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        cursor: running ? "not-allowed" : "pointer",
        fontSize: 11,
        color: runAsRoot ? "#ef4444" : "var(--muted)",
        userSelect: "none"
      }}
    >
      <input
        type="checkbox"
        checked={runAsRoot}
        disabled={running}
        onChange={(e) => runStore.getState().setRunAsRoot(e.target.checked)}
        style={{ margin: 0 }}
      />
      <span>Root</span>
    </label>
  )
}

function renderSegmentText(
  text: string,
  workspaceRoot: string | undefined,
  onJump: (file: string, line: number) => void
) {
  const lines = text.split("\n")
  return lines.map((line, idx) => {
    const isLast = idx === lines.length - 1
    const frameMatch = line.match(/^(\s*File ")([^"]+)(",\s*line\s*)(\d+)((?:,\s*in .*)?)$/)
    if (frameMatch) {
      const [, prefix, file, middle, lineStr, suffix] = frameMatch
      const lineNum = parseInt(lineStr, 10)
      const isWorkspace = isInsideWorkspace(file, workspaceRoot)
      const targetPath = toWorkspacePath(file, workspaceRoot)

      if (isWorkspace && targetPath) {
        return (
          <span key={idx} className="traceback-frame-line">
            {prefix}
            <button
              type="button"
              className="traceback-link"
              onClick={() => onJump(targetPath, lineNum)}
              title={`Jump to ${targetPath}:${lineNum}`}
            >
              {file}
            </button>
            {middle}
            <button
              type="button"
              className="traceback-link"
              onClick={() => onJump(targetPath, lineNum)}
              title={`Jump to ${targetPath}:${lineNum}`}
            >
              {lineStr}
            </button>
            {suffix}
            {!isLast && "\n"}
          </span>
        )
      }
    }

    return (
      <span key={idx}>
        {line}
        {!isLast && "\n"}
      </span>
    )
  })
}
