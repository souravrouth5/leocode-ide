import { useStore } from "zustand"
import { useStores } from "../app/stores"
import { Sheet } from "./Sheet"

/** Workspace search results; a row jumps to its line in the editor (Task 16). */
export function SearchPanel() {
  const { search } = useStores()
  const open = useStore(search, (state) => state.open)
  const query = useStore(search, (state) => state.query)
  const glob = useStore(search, (state) => state.glob)
  const caseSensitive = useStore(search, (state) => state.caseSensitive)
  const results = useStore(search, (state) => state.results)
  const running = useStore(search, (state) => state.running)
  const count = useStore(search, (state) => state.count)
  const truncated = useStore(search, (state) => state.truncated)

  return (
    <Sheet open={open} onClose={() => search.getState().setOpen(false)} title="Search in Workspace">
      <form
        className="workspace-search"
        onSubmit={(event) => {
          event.preventDefault()
          void search.getState().search()
        }}
      >
        <label className="field">
          <span>Find</span>
          <input
            value={query}
            autoFocus={open}
            onChange={(event) => search.getState().setQuery(event.target.value)}
            placeholder="Text to find"
          />
        </label>
        <label className="field">
          <span>Files (glob)</span>
          <input
            value={glob}
            onChange={(event) => search.getState().setGlob(event.target.value)}
            placeholder="*.py, src/**"
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => search.getState().setCaseSensitive(event.target.checked)}
          />
          <span>Match case</span>
        </label>
        <div className="find-actions">
          <button className="btn primary" type="submit" disabled={!query.trim() || running}>
            {running ? "Searching…" : "Search"}
          </button>
          <button
            className="btn ghost"
            type="button"
            disabled={!running}
            onClick={() => search.getState().cancel()}
          >
            Cancel
          </button>
        </div>
      </form>

      <div className="search-summary" role="status">
        {running
          ? `${results.length} match${results.length === 1 ? "" : "es"} so far…`
          : count === 0
            ? "No matches"
            : `${count} match${count === 1 ? "" : "es"}${truncated ? " (limited)" : ""}`}
      </div>

      <div className="search-results">
        {results.map((match, index) => (
          <button
            key={`${match.path}:${match.line}:${match.col}:${index}`}
            className="search-result"
            onClick={() => void search.getState().jump(match)}
          >
            <span className="search-result-path">
              {match.path}
              <span className="search-result-line">:{match.line}</span>
            </span>
            <span className="search-result-preview">{match.preview}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
