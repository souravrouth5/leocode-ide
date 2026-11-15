import { useEffect, useState } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { Sheet } from "../../components/Sheet"
import { TrashIcon } from "../../components/Icons"

type AuthKind = "https" | "ssh" | "none"

/**
 * Remotes sheet (Task 22).
 *
 * The URL and the auth choice are configuration; a token typed here is sent
 * once with `git.remote.set`, sealed by the host and never returned. The list
 * only ever shows `hasToken`, so a token cannot be read back out of the UI.
 */
export function RemoteSheet() {
  const { git } = useStores()
  const open = useStore(git, (state) => state.remoteSheetOpen)
  const remotes = useStore(git, (state) => state.remotes)
  const sshKeys = useStore(git, (state) => state.sshKeys)
  const [name, setName] = useState("origin")
  const [url, setUrl] = useState("")
  const [authKind, setAuthKind] = useState<AuthKind>("https")
  const [username, setUsername] = useState("")
  const [token, setToken] = useState("")
  const [keyId, setKeyId] = useState("")

  useEffect(() => {
    if (!open) return
    void git.getState().loadSshKeys()
  }, [open, git])

  const reset = () => {
    setName("origin")
    setUrl("")
    setAuthKind("https")
    setUsername("")
    setToken("")
    setKeyId("")
  }

  const edit = (remoteName: string) => {
    const remote = remotes.find((item) => item.name === remoteName)
    if (!remote) return
    setName(remote.name)
    setUrl(remote.url)
    setAuthKind((remote.authKind as AuthKind | undefined) ?? "https")
    setUsername(remote.username ?? "")
    setToken("")
    setKeyId(remote.keyId ?? "")
  }

  const save = async () => {
    const saved = await git.getState().saveRemote({
      name,
      url,
      authKind,
      username: authKind === "https" ? username : null,
      token: authKind === "https" ? token : null,
      keyId: authKind === "ssh" ? keyId : null
    })
    if (saved) reset()
  }

  return (
    <Sheet open={open} onClose={() => git.getState().closeRemotes()} title="Remotes">
      <div className="git-sheet">
        {remotes.length === 0 ? (
          <p className="git-note">No remote is configured for this repository.</p>
        ) : (
          <ul className="git-remote-list">
            {remotes.map((remote) => (
              <li key={remote.name} className="git-remote-row">
                <div className="git-remote-text">
                  <strong>{remote.name}</strong>
                  <span className="git-remote-url">{remote.url}</span>
                  <span className="git-remote-meta">
                    {remote.authKind === "ssh"
                      ? `SSH${remote.keyId ? " · key selected" : " · no key"}`
                      : remote.authKind === "https"
                        ? `HTTPS${remote.hasToken ? " · token stored" : " · no token"}`
                        : "No auth"}
                  </span>
                </div>
                <div className="git-remote-actions">
                  <button className="btn tiny" onClick={() => edit(remote.name)}>
                    Edit
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Remove remote ${remote.name}`}
                    onClick={() => void git.getState().removeRemote(remote.name)}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <h3 className="git-sheet-title">{remotes.some((item) => item.name === name) ? "Edit remote" : "Add remote"}</h3>
        <div className="git-form">
          <label className="git-field">
            <span>Name</span>
            <input
              value={name}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="git-field">
            <span>URL</span>
            <input
              value={url}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://github.com/user/repo.git"
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="git-field">
            <span>Authentication</span>
            <select
              value={authKind}
              onChange={(event) => setAuthKind(event.target.value as AuthKind)}
            >
              <option value="https">HTTPS token</option>
              <option value="ssh">SSH key</option>
              <option value="none">None (public)</option>
            </select>
          </label>

          {authKind === "https" && (
            <>
              <label className="git-field">
                <span>Username</span>
                <input
                  value={username}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="x-access-token"
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label className="git-field">
                <span>Token</span>
                <input
                  type="password"
                  value={token}
                  autoComplete="off"
                  placeholder="Stored in the device keystore"
                  onChange={(event) => setToken(event.target.value)}
                />
              </label>
              <p className="git-hint">
                Leave the token blank to keep the one already stored. Remove the remote to
                delete its token.
              </p>
            </>
          )}

          {authKind === "ssh" && (
            <label className="git-field">
              <span>SSH key</span>
              <select value={keyId} onChange={(event) => setKeyId(event.target.value)}>
                <option value="">Select a key…</option>
                {sshKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.label} · {key.type}
                    {key.hasPassphrase ? " · passphrase" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="git-conflict-actions">
            <button className="btn ghost" onClick={reset}>
              Clear
            </button>
            <button className="btn primary" disabled={!name.trim() || !url.trim()} onClick={() => void save()}>
              Save remote
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  )
}
