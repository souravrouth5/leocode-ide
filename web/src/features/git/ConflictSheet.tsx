import { useEffect, useState } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { Sheet } from "../../components/Sheet"

/**
 * Conflict resolution (Task 22).
 *
 * The host splits the conflict markers into ours/theirs; the user either takes
 * a whole side (a checkout of that stage) or edits the merged text and saves it,
 * which writes the file and stages it.
 */
export function ConflictSheet() {
  const { git } = useStores()
  const conflict = useStore(git, (state) => state.conflict)
  const [merged, setMerged] = useState("")

  useEffect(() => {
    if (conflict) setMerged(conflict.merged ?? "")
  }, [conflict])

  const close = () => git.getState().closeConflict()

  return (
    <Sheet open={conflict !== null} onClose={close} title={conflict ? `Conflict · ${conflict.file}` : "Conflict"}>
      {conflict === null ? null : conflict.binary ? (
        <div className="git-conflict-sheet">
          <p className="git-note">
            This file is binary. Choose the version to keep; there is no text to merge.
          </p>
          <div className="git-conflict-actions">
            <button className="btn ghost" onClick={() => void git.getState().resolveFile("ours")}>
              Keep mine
            </button>
            <button className="btn ghost" onClick={() => void git.getState().resolveFile("theirs")}>
              Use incoming
            </button>
          </div>
        </div>
      ) : (
        <div className="git-conflict-sheet">
          <div className="git-conflict-actions">
            <button className="btn ghost" onClick={() => void git.getState().resolveFile("ours")}>
              Keep mine
            </button>
            <button className="btn ghost" onClick={() => void git.getState().resolveFile("theirs")}>
              Use incoming
            </button>
          </div>
          <label className="git-field">
            <span>Merged content</span>
            <textarea
              className="git-conflict-editor"
              rows={16}
              spellCheck={false}
              value={merged}
              onChange={(event) => setMerged(event.target.value)}
            />
          </label>
          <div className="git-conflict-actions">
            <button className="btn primary" onClick={() => void git.getState().saveConflict(merged)}>
              Save merged
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
