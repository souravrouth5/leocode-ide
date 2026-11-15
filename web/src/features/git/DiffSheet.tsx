import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { Sheet } from "../../components/Sheet"

/** Read-only unified diff for one file (`git.diff`). */
export function DiffSheet() {
  const { git } = useStores()
  const diff = useStore(git, (state) => state.diff)

  return (
    <Sheet open={diff !== null} onClose={() => git.getState().closeDiff()} title={diff?.file ?? "Diff"}>
      {diff === null ? null : diff.binary ? (
        <p className="git-note">This file is binary, so there is no text diff to show.</p>
      ) : (
        <>
          {diff.truncated && (
            <p className="git-note">The diff is large and was truncated by the host.</p>
          )}
          {diff.diff?.trim() ? (
            <pre className="git-diff">{diff.diff}</pre>
          ) : (
            <p className="git-note">No textual changes.</p>
          )}
        </>
      )}
    </Sheet>
  )
}
