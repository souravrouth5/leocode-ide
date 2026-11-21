import { useEffect, useRef, useState, type FormEvent } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { Sheet } from "../../components/Sheet"
import type { ConfirmRequest, PromptRequest } from "./dialogStore"

/**
 * Renders the in-app confirm/prompt request (PD-02). The sheet stays mounted
 * while closed, like every other sheet, so opening one does not remount the
 * portal.
 */
export function DialogHost() {
  const { dialogs } = useStores()
  const request = useStore(dialogs, (state) => state.request)
  const cancel = () => dialogs.getState().cancel()
  const title =
    request === null
      ? ""
      : request.kind === "confirm"
        ? (request.options.title ?? "Confirm")
        : request.options.title

  return (
    <Sheet open={request !== null} onClose={cancel} title={title}>
      {request?.kind === "confirm" && (
        <ConfirmBody key={request.id} request={request} />
      )}
      {request?.kind === "prompt" && <PromptBody key={request.id} request={request} />}
    </Sheet>
  )
}

function ConfirmBody({ request }: { request: ConfirmRequest }) {
  const { dialogs } = useStores()
  const { message, detail, confirmLabel, cancelLabel, danger } = request.options
  const messageId = `dialog-message-${request.id}`
  const confirmButton = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => confirmButton.current?.focus(), 80)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <form
      className="prompt"
      onSubmit={(event) => {
        event.preventDefault()
        dialogs.getState().accept()
      }}
    >
      <p className="guide-intro" id={messageId}>
        {message}
      </p>
      {detail && <p className="guide-intro">{detail}</p>}
      <div className="prompt-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => dialogs.getState().cancel()}
        >
          {cancelLabel ?? "Cancel"}
        </button>
        <button
          type="submit"
          ref={confirmButton}
          className={"btn primary" + (danger ? " danger" : "")}
          aria-describedby={messageId}
        >
          {confirmLabel ?? "OK"}
        </button>
      </div>
    </form>
  )
}

function PromptBody({ request }: { request: PromptRequest }) {
  const { dialogs } = useStores()
  const {
    label,
    initial,
    placeholder,
    confirmLabel,
    cancelLabel,
    validate,
    secret,
    trim = true
  } = request.options
  const [value, setValue] = useState(initial ?? "")
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const inputId = `dialog-input-${request.id}`
  const errorId = `dialog-error-${request.id}`

  useEffect(() => {
    const timer = window.setTimeout(() => {
      input.current?.focus()
      input.current?.select()
    }, 80)
    return () => window.clearTimeout(timer)
  }, [])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const answer = trim ? value.trim() : value
    if (!answer) {
      setError("Enter a value.")
      return
    }
    const problem = validate?.(answer) ?? null
    if (problem) {
      setError(problem)
      return
    }
    dialogs.getState().answer(answer)
  }

  return (
    <form className="prompt" onSubmit={submit}>
      <label htmlFor={inputId}>{label ?? "Value"}</label>
      <input
        id={inputId}
        ref={input}
        value={value}
        type={secret ? "password" : "text"}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setValue(event.target.value)
          if (error) setError(null)
        }}
      />
      {error && (
        <p className="prompt-error" id={errorId} role="alert">
          {error}
        </p>
      )}
      <div className="prompt-actions">
        <button
          type="button"
          className="btn ghost"
          onClick={() => dialogs.getState().cancel()}
        >
          {cancelLabel ?? "Cancel"}
        </button>
        <button type="submit" className="btn primary" disabled={trim ? !value.trim() : !value}>
          {confirmLabel ?? "OK"}
        </button>
      </div>
    </form>
  )
}
