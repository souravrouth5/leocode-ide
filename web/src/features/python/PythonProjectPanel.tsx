import { useEffect } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { WORKSPACE_SWITCHED_EVENT } from "../workspace/workspaceEvents"
import { classifyPipError, isPipFailure } from "./pipClassifier"

/**
 * The active project's Python environment (Task 26).
 *
 * The Run action does the same work automatically; this panel is where a user
 * can see what exists, create or remove `.venv`, and install `requirements.txt`
 * with the trust prompt and pip output visible.
 */
export function PythonProjectPanel() {
  const { python, notifications } = useStores()
  const status = useStore(python, (state) => state.status)
  const busy = useStore(python, (state) => state.busy)
  const log = useStore(python, (state) => state.installLog)

  useEffect(() => {
    void python.getState().refresh()
    const reload = () => {
      void python.getState().refresh()
    }
    window.addEventListener(WORKSPACE_SWITCHED_EVENT, reload)
    return () => window.removeEventListener(WORKSPACE_SWITCHED_EVENT, reload)
  }, [python])

  const requirements = status?.requirementsExists
    ? status.requirementsInstalled
      ? "installed"
      : "not installed"
    : "no requirements.txt"

  const isFailed =
    !busy &&
    status?.requirementsExists &&
    !status?.requirementsInstalled &&
    log.length > 0
  const classification =
    isFailed || (log.length > 0 && isPipFailure(log))
      ? classifyPipError(log)
      : null

  return (
    <section className="env-section python-project" aria-labelledby="python-project-title">
      <h2 className="env-heading" id="python-project-title">
        This project's Python
      </h2>
      <p className="env-sub">
        Scripts run with the project's <code>.venv</code> when it exists, otherwise with the
        bundled runtime.
      </p>

      <div className="python-status">
        <div>
          <span className="python-label">Runtime</span>
          <span className="python-value">
            {status?.runtimeInstalled
              ? status.runtimePython ?? "installed"
              : "not installed"}
          </span>
        </div>
        <div>
          <span className="python-label">Environment</span>
          <span className="python-value">
            {status?.venvExists ? status.venvPython ?? ".venv" : "not created"}
          </span>
        </div>
        <div>
          <span className="python-label">requirements.txt</span>
          <span className="python-value">{requirements}</span>
        </div>
        <div>
          <span className="python-label">Terminal aliases</span>
          <span className="python-value">{status?.aliasesReady ? "python, pip" : "missing"}</span>
        </div>
      </div>

      <div className="runtime-card-actions">
        {status?.venvExists ? (
          <button
            className="btn ghost small"
            disabled={busy}
            onClick={() => void python.getState().removeVenv()}
          >
            Remove environment
          </button>
        ) : (
          <button
            className="btn primary small"
            disabled={busy || !status?.runtimeInstalled}
            onClick={() => {
              void python.getState().ensureVenv()
            }}
          >
            Create environment
          </button>
        )}
        <button
          className="btn small"
          disabled={busy || !status?.requirementsExists || !status?.venvExists}
          onClick={() => {
            void python.getState().installRequirements()
          }}
        >
          Install requirements
        </button>
        <button
          className="btn ghost small"
          disabled={busy}
          onClick={() => {
            void python.getState().refresh().then(() => {
              if (!python.getState().status) {
                notifications.getState().enqueue({
                  kind: "warning",
                  message: "Could not read the Python status",
                  durationMs: 4_000
                })
              }
            })
          }}
        >
          Refresh
        </button>
      </div>

      {classification && (
        <div
          className="pip-error-summary"
          role="alert"
          aria-label="Package installation failure explanation"
          style={{
            margin: "12px 0 0",
            padding: "12px",
            borderRadius: "8px",
            border: "1px solid var(--danger, #ef4444)",
            background: "rgba(239, 68, 68, 0.08)",
            fontSize: "13px",
            lineHeight: "1.4"
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--danger, #ef4444)", marginBottom: "4px" }}>
            Installation failed: {classification.kind.replace(/_/g, " ")}
          </div>
          <p style={{ margin: "4px 0", color: "var(--foreground, inherit)" }}>
            {classification.explanation}
          </p>
          {classification.package && (
            <p style={{ margin: "4px 0", color: "var(--muted, #888)" }}>
              Package: <code>{classification.package}</code>
            </p>
          )}
          {classification.suggestedAction && (
            <p style={{ margin: "6px 0 0", color: "var(--foreground, inherit)" }}>
              💡 {classification.suggestedAction}
            </p>
          )}
        </div>
      )}

      {log.length > 0 && (
        <pre className="python-log" aria-label="pip output">
          {log.join("\n")}
        </pre>
      )}
    </section>
  )
}
