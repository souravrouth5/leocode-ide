import { useStore } from "zustand"
import { useStores } from "../../app/stores"

const LABELS: Record<string, string> = {
  clone: "Cloning",
  fetch: "Fetching",
  pull: "Pulling",
  push: "Pushing"
}

/**
 * Progress row for the long Git network operations (Phase F).
 *
 * clone/fetch/pull/push reply only when they finish, so this row is the only
 * feedback while the transfer runs. The cancel button sends `git.cancel` with
 * the operation id; the request then fails with `E_CANCELLED`.
 */
export function GitProgressBanner() {
  const { git } = useStores()
  const busy = useStore(git, (state) => state.busy)
  const progress = useStore(git, (state) => state.progress)
  const opId = useStore(git, (state) => state.opId)
  if (!busy) return null

  const op = progress?.op ?? ""
  const total = progress?.total ?? 0
  const done = progress?.done ?? 0
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null
  const task = progress?.task?.trim()

  return (
    <div className="git-progress" role="status" aria-live="polite">
      <span className="dot live" aria-hidden="true" />
      <span className="git-progress-label">{LABELS[op] ?? "Git operation"}</span>
      {task && <span className="git-progress-task">{task}</span>}
      {percent !== null && (
        <span className="git-progress-meter" aria-hidden="true">
          <span style={{ width: `${percent}%` }} />
        </span>
      )}
      {percent !== null && <span className="git-progress-pct">{percent}%</span>}
      {opId && (
        <button className="btn tiny" onClick={() => void git.getState().cancel()}>
          Cancel
        </button>
      )}
    </div>
  )
}
