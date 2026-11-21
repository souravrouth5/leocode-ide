import { useState } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { Sheet } from "../../components/Sheet"

/**
 * SSH host-key verification (Task 23).
 *
 * An unknown host blocks the clone/fetch/pull/push until the user answers; the
 * request waits up to 120 s and then fails as "not trusted". A host whose key
 * changed never reaches this sheet: the host fails with E_HOSTKEY_CHANGED and
 * the user has to forget the old key first.
 */
export function HostKeySheet() {
  const { git } = useStores()
  const prompt = useStore(git, (state) => state.hostPrompt)
  const [remember, setRemember] = useState(true)

  const answer = (trust: boolean) => {
    void git.getState().answerHostPrompt(trust, remember)
  }

  return (
    <Sheet
      open={prompt !== null}
      onClose={() => answer(false)}
      title={prompt?.changed ? "Host key changed" : "New SSH host"}
    >
      {prompt === null ? null : (
        <div className="git-hostkey">
          <p className={prompt.changed ? "git-warning" : "git-note"}>
            {prompt.changed
              ? `The key of ${prompt.host} does not match the stored key. Connecting could expose the repository to an attacker.`
              : `First connection to ${prompt.host}. Check the fingerprint with the server administrator before trusting it.`}
          </p>
          <dl className="git-facts">
            <div>
              <dt>Host</dt>
              <dd>
                {prompt.host}:{prompt.port}
              </dd>
            </div>
            <div>
              <dt>Key type</dt>
              <dd>{prompt.keyType}</dd>
            </div>
            <div>
              <dt>Fingerprint</dt>
              <dd>
                <code>{prompt.fingerprintSha256}</code>
              </dd>
            </div>
            {prompt.changed && prompt.previousFingerprint && (
              <div>
                <dt>Stored</dt>
                <dd>
                  <code>{prompt.previousFingerprint}</code>
                </dd>
              </div>
            )}
          </dl>
          <label className="git-check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>Remember this key for future connections</span>
          </label>
          <div className="git-conflict-actions">
            <button className="btn ghost" onClick={() => answer(false)}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => answer(true)}>
              Trust and connect
            </button>
          </div>
        </div>
      )}
    </Sheet>
  )
}
