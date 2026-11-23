import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { DownloadIcon, RefreshIcon, XIcon } from "../../components/Icons"
import { describeUpdateStatus, formatBytes } from "./updateCopy"

/**
 * Settings › About › Updates (Task 28).
 *
 * The card only ever shows verified data: the version comes from the signed
 * manifest the host accepted, not from a URL the user typed. Installing opens
 * Android's own installer, so the final confirmation is always the system's.
 */
export function UpdatesCard({ version }: { version: string }) {
  const { updates } = useStores()
  const status = useStore(updates, (state) => state.status)
  const check = useStore(updates, (state) => state.check)
  const progress = useStore(updates, (state) => state.progress)
  const error = useStore(updates, (state) => state.error)
  const checkedAt = useStore(updates, (state) => state.checkedAt)

  const busy = status === "checking" || status === "downloading" || status === "verifying"
  const installing = status === "downloading" || status === "verifying"
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.bytes / progress.total) * 100))
      : 0

  return (
    <div className="settings-card update-card">
      <div className="settings-card-row">
        <label className="settings-card-label">Updates</label>
        <span className="theme-badge">{check?.currentVersion ?? version}</span>
      </div>

      <p className="guide-intro update-status" aria-live="polite">
        {describeUpdateStatus(status, check, error)}
      </p>

      {installing && progress && (
        <div
          className="update-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Update download"
        >
          <div className="update-progress-bar" style={{ width: `${percent}%` }} />
          <span className="update-progress-text">
            {progress.phase === "verify"
              ? "Checking the download…"
              : `${formatBytes(progress.bytes)} of ${formatBytes(progress.total)}`}
          </span>
        </div>
      )}

      {status === "available" && check?.size != null && (
        <p className="update-meta">
          {check.versionName} · {formatBytes(check.size)}
        </p>
      )}

      {check?.notes && (status === "available" || status === "installer") && (
        <p className="update-notes">{check.notes}</p>
      )}

      {checkedAt !== null && status !== "checking" && (
        <p className="update-meta">
          Last checked {new Date(checkedAt).toLocaleTimeString()}
        </p>
      )}

      <div className="update-actions">
        {status === "available" ? (
          <button className="btn primary full-width" onClick={() => void updates.getState().install()}>
            <DownloadIcon size={18} />
            <span>Download and install</span>
          </button>
        ) : installing ? (
          <button className="btn full-width" onClick={() => updates.getState().cancel()}>
            <XIcon size={18} />
            <span>Cancel download</span>
          </button>
        ) : (
          <button
            className="btn full-width"
            onClick={() => void updates.getState().checkForUpdate()}
            disabled={busy}
          >
            <RefreshIcon size={18} />
            <span>{status === "checking" ? "Checking…" : "Check for updates"}</span>
          </button>
        )}
      </div>
    </div>
  )
}
