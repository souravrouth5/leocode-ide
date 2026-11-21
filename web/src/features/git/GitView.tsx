import { useEffect, useState } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import type { GitFileChange } from "../../bridge"
import {
  CheckIcon,
  GitIcon,
  HistoryIcon,
  PlusIcon,
  RefreshIcon,
  TrashIcon
} from "../../components/Icons"
import type { GitTab } from "./gitStore"

const TABS: Array<{ id: GitTab; label: string }> = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
  { id: "branches", label: "Branches" }
]

function shortTime(time: number): string {
  if (!Number.isFinite(time) || time <= 0) return ""
  return new Date(time).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  })
}

function changeLabel(change: GitFileChange): string {
  switch (change.status) {
    case "added":
      return "A"
    case "modified":
      return "M"
    case "deleted":
      return "D"
    case "untracked":
      return "U"
    case "conflicted":
      return "!"
    default:
      return "•"
  }
}

function ChangeRow({
  change,
  actionLabel,
  onAction,
  onOpen
}: {
  change: GitFileChange
  actionLabel: string
  onAction: () => void
  onOpen: () => void
}) {
  return (
    <li className={"git-file status-" + change.status}>
      <button className="git-file-main" onClick={onOpen} title={`Show the diff for ${change.path}`}>
        <span className="git-file-badge" aria-hidden="true">
          {changeLabel(change)}
        </span>
        <span className="git-file-path">{change.path}</span>
      </button>
      <button className="btn tiny" onClick={onAction}>
        {actionLabel}
      </button>
    </li>
  )
}

/**
 * The Git tab (Phase F, Tasks 21–23): working tree, history and branches for
 * the workspace root. Every action goes through the Git store, so errors and
 * notifications have one home and long network operations can be cancelled
 * from the progress banner.
 */
export function GitView() {
  const { git, shell } = useStores()
  const view = useStore(shell, (state) => state.view)
  const status = useStore(git, (state) => state.status)
  const tab = useStore(git, (state) => state.tab)
  const busy = useStore(git, (state) => state.busy)
  const log = useStore(git, (state) => state.log)
  const branches = useStore(git, (state) => state.branches)
  const currentBranch = useStore(git, (state) => state.currentBranch)
  const [message, setMessage] = useState("")
  const [branchName, setBranchName] = useState("")
  const [cloneUrl, setCloneUrl] = useState("")

  useEffect(() => {
    if (view !== "git") return
    void git.getState().refresh()
    void git.getState().loadRemotes()
    void git.getState().loadSshKeys()
  }, [view, git])

  const staged = status?.staged ?? []
  const changed = status?.changed ?? []
  const untracked = status?.untracked ?? []
  const conflicts = status?.conflicts ?? []
  const dirty = staged.length + changed.length + untracked.length + conflicts.length > 0

  const stageAll = () => {
    const paths = [...changed, ...untracked].map((item) => item.path)
    void git.getState().stage(paths)
  }

  const submitCommit = async () => {
    const committed = await git.getState().commit(message)
    if (committed) setMessage("")
  }

  const createBranch = async () => {
    const created = await git.getState().createBranch(branchName)
    if (created) setBranchName("")
  }

  const clone = async () => {
    const cloned = await git.getState().clone(cloneUrl)
    if (cloned) setCloneUrl("")
  }

  return (
    <section
      className={"view git-view" + (view === "git" ? " current" : "")}
      aria-hidden={view !== "git"}
    >
      <header className="git-head">
        <div className="git-head-title">
          <GitIcon size={18} />
          <div className="git-head-text">
            <strong>{status?.initialized ? status.branch || "detached" : "No repository"}</strong>
            <span>
              {status?.initialized
                ? [
                    status.upstream ?? status.remote ?? "no remote",
                    status.ahead ? `${status.ahead} ahead` : null,
                    status.behind ? `${status.behind} behind` : null
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : "This workspace is not a Git repository yet"}
            </span>
          </div>
        </div>
        <div className="git-head-actions">
          <button
            className="icon-btn"
            onClick={() => void git.getState().refresh()}
            aria-label="Refresh Git status"
          >
            <RefreshIcon size={18} />
          </button>
          <button className="btn tiny" onClick={() => void git.getState().openRemotes()}>
            Remotes
          </button>
          <button className="btn tiny" onClick={() => void git.getState().openSshKeys()}>
            SSH
          </button>
        </div>
      </header>

      {!status?.initialized ? (
        <div className="git-empty">
          <p>Turn this workspace into a repository, or clone a remote into it.</p>
          <div className="git-empty-actions">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void git.getState().init()}
            >
              Initialize repository
            </button>
          </div>
          <div className="git-form">
            <label className="git-field">
              <span>Clone URL</span>
              <input
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://example.com/repo.git"
                value={cloneUrl}
                onChange={(event) => setCloneUrl(event.target.value)}
              />
            </label>
            <button
              className="btn ghost"
              disabled={busy || !cloneUrl.trim()}
              onClick={() => void clone()}
            >
              Clone
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="git-toolbar">
            <button
              className="btn tiny"
              disabled={busy}
              onClick={() => void git.getState().fetch()}
            >
              Fetch
            </button>
            <button
              className="btn tiny"
              disabled={busy}
              onClick={() => void git.getState().pull()}
            >
              Pull
            </button>
            <button
              className="btn tiny"
              disabled={busy}
              onClick={() => void git.getState().push()}
            >
              Push
            </button>
            <span className={"git-clean" + (dirty ? " dirty" : "")}>
              {dirty ? "Uncommitted changes" : "Working tree clean"}
            </span>
          </div>

          <div className="git-tabs" role="tablist" aria-label="Git sections">
            {TABS.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                className={"git-tab" + (tab === item.id ? " active" : "")}
                onClick={() => git.getState().setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === "changes" && (
            <div className="git-panel">
              {conflicts.length > 0 && (
                <section className="git-section git-conflicts">
                  <h3>
                    Conflicts <span className="git-count">{conflicts.length}</span>
                  </h3>
                  <ul className="git-file-list">
                    {conflicts.map((change) => (
                      <li key={change.path} className="git-file status-conflicted">
                        <button
                          className="git-file-main"
                          onClick={() => void git.getState().openConflict(change.path)}
                        >
                          <span className="git-file-badge" aria-hidden="true">
                            !
                          </span>
                          <span className="git-file-path">{change.path}</span>
                        </button>
                        <button
                          className="btn tiny"
                          onClick={() => void git.getState().openConflict(change.path)}
                        >
                          Resolve
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {staged.length > 0 && (
                <section className="git-section">
                  <h3>
                    Staged <span className="git-count">{staged.length}</span>
                  </h3>
                  <ul className="git-file-list">
                    {staged.map((change) => (
                      <ChangeRow
                        key={"staged-" + change.path}
                        change={change}
                        actionLabel="Unstage"
                        onAction={() => void git.getState().unstage([change.path])}
                        onOpen={() => void git.getState().openDiff(change.path, true)}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {(changed.length > 0 || untracked.length > 0) && (
                <section className="git-section">
                  <h3 className="git-section-head">
                    Changes
                    <button className="btn tiny" onClick={stageAll}>
                      Stage all
                    </button>
                  </h3>
                  <ul className="git-file-list">
                    {changed.map((change) => (
                      <ChangeRow
                        key={"changed-" + change.path}
                        change={change}
                        actionLabel="Stage"
                        onAction={() => void git.getState().stage([change.path])}
                        onOpen={() => void git.getState().openDiff(change.path)}
                      />
                    ))}
                    {untracked.map((change) => (
                      <ChangeRow
                        key={"untracked-" + change.path}
                        change={change}
                        actionLabel="Stage"
                        onAction={() => void git.getState().stage([change.path])}
                        onOpen={() => void git.getState().openDiff(change.path)}
                      />
                    ))}
                  </ul>
                </section>
              )}

              {!dirty && <p className="git-note">Nothing to commit.</p>}

              <section className="git-section git-commit">
                <label className="git-field">
                  <span>Commit message</span>
                  <textarea
                    rows={3}
                    placeholder="Describe the change"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </label>
                <button
                  className="btn primary"
                  disabled={staged.length === 0 || !message.trim()}
                  onClick={() => void submitCommit()}
                >
                  <CheckIcon size={16} />
                  Commit {staged.length > 0 ? `${staged.length} file${staged.length === 1 ? "" : "s"}` : ""}
                </button>
              </section>
            </div>
          )}

          {tab === "history" && (
            <div className="git-panel">
              {log.length === 0 ? (
                <p className="git-note">No commits yet.</p>
              ) : (
                <ul className="git-commit-list">
                  {log.map((commit) => (
                    <li key={commit.sha} className="git-commit-row">
                      <div className="git-commit-text">
                        <strong>{commit.message}</strong>
                        <span>
                          {commit.author} · {shortTime(commit.time)}
                        </span>
                      </div>
                      <code className="git-sha">{commit.shortSha}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {tab === "branches" && (
            <div className="git-panel">
              <div className="git-form git-branch-create">
                <label className="git-field">
                  <span>New branch</span>
                  <input
                    value={branchName}
                    placeholder="feature/name"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) => setBranchName(event.target.value)}
                  />
                </label>
                <button
                  className="btn ghost"
                  disabled={!branchName.trim()}
                  onClick={() => void createBranch()}
                >
                  <PlusIcon size={16} />
                  Create
                </button>
              </div>

              <ul className="git-branch-list">
                <li className="git-branch-row">
                  <HistoryIcon size={16} />
                  <span className="git-branch-name">{currentBranch || "detached"}</span>
                  <span className="git-branch-tag">current</span>
                </li>
                {branches
                  .filter((branch) => !branch.current && !branch.remote)
                  .map((branch) => (
                    <li key={branch.name} className="git-branch-row">
                      <GitIcon size={16} />
                      <span className="git-branch-name">{branch.name}</span>
                      <button
                        className="btn tiny"
                        onClick={() => void git.getState().checkout(branch.name)}
                      >
                        Checkout
                      </button>
                      <button
                        className="icon-btn"
                        aria-label={`Delete branch ${branch.name}`}
                        onClick={() => void git.getState().deleteBranch(branch.name)}
                      >
                        <TrashIcon size={16} />
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  )
}
