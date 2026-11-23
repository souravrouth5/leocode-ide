import { useStore } from "zustand"
import { useStores } from "../app/stores"
import { Sheet } from "./Sheet"

/** Find/replace sheet for the active buffer (Task 15). */
export function FindReplaceSheet() {
  const { findReplace } = useStores()
  const open = useStore(findReplace, (state) => state.open)
  const query = useStore(findReplace, (state) => state.query)
  const replacement = useStore(findReplace, (state) => state.replacement)
  const caseSensitive = useStore(findReplace, (state) => state.caseSensitive)
  const regexp = useStore(findReplace, (state) => state.regexp)

  return (
    <Sheet open={open} onClose={() => findReplace.getState().close()} title="Find & Replace">
      <form
        className="find-replace"
        onSubmit={(event) => {
          event.preventDefault()
          findReplace.getState().findNext()
        }}
      >
        <label className="field">
          <span>Find</span>
          <input
            value={query}
            autoFocus={open}
            onChange={(event) => findReplace.getState().setQuery(event.target.value)}
            placeholder="Text to find"
          />
        </label>
        <label className="field">
          <span>Replace with</span>
          <input
            value={replacement}
            onChange={(event) => findReplace.getState().setReplacement(event.target.value)}
            placeholder="Replacement"
          />
        </label>
        <div className="find-options">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(event) => findReplace.getState().setCaseSensitive(event.target.checked)}
            />
            <span>Match case</span>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={regexp}
              onChange={(event) => findReplace.getState().setRegexp(event.target.checked)}
            />
            <span>Regular expression</span>
          </label>
        </div>
        <div className="find-actions">
          <button className="btn primary" type="submit" disabled={!query}>
            Find next
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!query}
            onClick={() => findReplace.getState().replaceNext()}
          >
            Replace
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!query}
            onClick={() => findReplace.getState().replaceAll()}
          >
            Replace all
          </button>
        </div>
      </form>
    </Sheet>
  )
}
