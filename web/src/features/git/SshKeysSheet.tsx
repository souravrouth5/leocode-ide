import { useState } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { Sheet } from "../../components/Sheet"
import { TrashIcon } from "../../components/Icons"

/** SSH identities and known hosts (Task 23). */
export function SshKeysSheet() {
  const { git, notifications } = useStores()
  const open = useStore(git, (state) => state.sshSheetOpen)
  const keys = useStore(git, (state) => state.sshKeys)
  const knownHosts = useStore(git, (state) => state.knownHosts)
  const [type, setType] = useState<"ed25519" | "rsa">("ed25519")
  const [bits, setBits] = useState("3072")
  const [comment, setComment] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [label, setLabel] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importContent, setImportContent] = useState("")
  const [importPassphrase, setImportPassphrase] = useState("")
  const [importLabel, setImportLabel] = useState("")

  const generate = async () => {
    const created = await git.getState().generateKey({
      type,
      bits: type === "rsa" ? Number(bits) : null,
      comment: comment.trim() ? comment : null,
      passphrase: passphrase ? passphrase : null,
      label: label.trim() ? label : null
    })
    if (created) {
      setComment("")
      setPassphrase("")
      setLabel("")
    }
  }

  const importKey = async () => {
    const imported = await git.getState().importKey(importContent, importPassphrase || undefined, importLabel || undefined)
    if (imported) {
      setImportContent("")
      setImportPassphrase("")
      setImportLabel("")
      setImportOpen(false)
    }
  }

  const copyPublicKey = async (publicKey: string | undefined) => {
    if (!publicKey) return
    try {
      await navigator.clipboard.writeText(publicKey)
      notifications.getState().enqueue({ kind: "success", message: "Public key copied", durationMs: 2_500 })
    } catch {
      notifications.getState().enqueue({
        kind: "warning",
        message: "Could not copy the public key",
        durationMs: 3_000
      })
    }
  }

  return (
    <Sheet open={open} onClose={() => git.getState().closeSshKeys()} title="SSH keys">
      <div className="git-sheet">
        <h3 className="git-sheet-title">Keys on this device</h3>
        {keys.length === 0 ? (
          <p className="git-note">No SSH key yet. Generate one below, or import an existing private key.</p>
        ) : (
          <ul className="git-key-list">
            {keys.map((key) => (
              <li key={key.id} className="git-key-row">
                <div className="git-key-text">
                  <strong>{key.label}</strong>
                  <span>
                    {key.type}
                    {key.hasPassphrase ? " · passphrase" : ""}
                  </span>
                  <code className="git-fingerprint">{key.fingerprint}</code>
                </div>
                <div className="git-key-actions">
                  <button className="btn tiny" onClick={() => void copyPublicKey(key.publicKey)}>
                    Copy public
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Delete SSH key ${key.label}`}
                    onClick={() => void git.getState().deleteKey(key.id)}
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <h3 className="git-sheet-title">Generate a key</h3>
        <div className="git-form">
          <div className="git-seg">
            <button
              className={"git-seg-btn" + (type === "ed25519" ? " active" : "")}
              onClick={() => setType("ed25519")}
            >
              Ed25519
            </button>
            <button
              className={"git-seg-btn" + (type === "rsa" ? " active" : "")}
              onClick={() => setType("rsa")}
            >
              RSA
            </button>
          </div>
          {type === "rsa" && (
            <label className="git-field">
              <span>Size</span>
              <select value={bits} onChange={(event) => setBits(event.target.value)}>
                <option value="2048">2048 bits</option>
                <option value="3072">3072 bits</option>
                <option value="4096">4096 bits</option>
              </select>
            </label>
          )}
          <label className="git-field">
            <span>Comment (shown next to the public key)</span>
            <input
              value={comment}
              placeholder="leocode@android"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setComment(event.target.value)}
            />
          </label>
          <label className="git-field">
            <span>Passphrase (optional, never stored in plaintext)</span>
            <input
              type="password"
              value={passphrase}
              autoComplete="off"
              onChange={(event) => setPassphrase(event.target.value)}
            />
          </label>
          <label className="git-field">
            <span>Label</span>
            <input value={label} placeholder="Phone key" onChange={(event) => setLabel(event.target.value)} />
          </label>
          <div className="git-conflict-actions">
            <button className="btn ghost" onClick={() => setImportOpen((value) => !value)}>
              {importOpen ? "Hide import" : "Import instead"}
            </button>
            <button className="btn primary" onClick={() => void generate()}>
              Generate key
            </button>
          </div>
        </div>

        {importOpen && (
          <>
            <h3 className="git-sheet-title">Import a private key</h3>
            <div className="git-form">
              <label className="git-field">
                <span>Private key (OpenSSH, PEM or PKCS#8)</span>
                <textarea
                  rows={5}
                  className="git-key-input"
                  value={importContent}
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  onChange={(event) => setImportContent(event.target.value)}
                />
              </label>
              <label className="git-field">
                <span>Passphrase (only if the file is encrypted)</span>
                <input
                  type="password"
                  value={importPassphrase}
                  autoComplete="off"
                  onChange={(event) => setImportPassphrase(event.target.value)}
                />
              </label>
              <label className="git-field">
                <span>Label</span>
                <input
                  value={importLabel}
                  placeholder="Laptop key"
                  onChange={(event) => setImportLabel(event.target.value)}
                />
              </label>
              <div className="git-conflict-actions">
                <button className="btn primary" disabled={!importContent.trim()} onClick={() => void importKey()}>
                  Import key
                </button>
              </div>
            </div>
          </>
        )}

        <h3 className="git-sheet-title">Known hosts</h3>
        {knownHosts.length === 0 ? (
          <p className="git-note">No host key has been trusted yet.</p>
        ) : (
          <ul className="git-key-list">
            {knownHosts.map((host) => (
              <li key={`${host.host}:${host.port ?? 22}:${host.fingerprint}`} className="git-key-row">
                <div className="git-key-text">
                  <strong>
                    {host.host}
                    {host.port && host.port !== 22 ? `:${host.port}` : ""}
                  </strong>
                  <span>{host.keyType}</span>
                  <code className="git-fingerprint">{host.fingerprint}</code>
                </div>
                <div className="git-key-actions">
                  <button
                    className="btn tiny"
                    onClick={() => void git.getState().forgetHost(host.host, host.port ?? 22)}
                  >
                    Forget
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  )
}
