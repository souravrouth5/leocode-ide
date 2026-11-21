import { useEffect, useRef, useState } from "react"
import { Sheet } from "./Sheet"

interface Props {
  open: boolean
  title: string
  label?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  /**
   * Return an error string to keep the sheet open with an inline message; return
   * `null`/nothing when the operation succeeded and the sheet may close (W-28).
   */
  onConfirm: (value: string) => void | string | null | Promise<void | string | null>
  onClose: () => void
}

export function PromptDialog({
  open,
  title,
  label,
  initialValue = "",
  placeholder,
  confirmLabel = "Create",
  onConfirm,
  onClose
}: Props) {
  const [value, setValue] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    setError(null)
    setBusy(false)
    const timer = window.setTimeout(() => {
      input.current?.focus()
      input.current?.select()
    }, 120)
    return () => window.clearTimeout(timer)
  }, [open, initialValue])

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed) {
      // Keep the sheet open instead of dropping what the user typed.
      setError("Enter a value.")
      return
    }
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await onConfirm(trimmed)
      if (mounted.current && typeof result === "string") {
        setError(result)
        return
      }
      // Only a success closes the sheet.
      if (mounted.current) onClose()
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "That did not work.")
    } finally {
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form
        className="prompt"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {label && <label htmlFor="prompt-input">{label}</label>}
        <input
          id="prompt-input"
          ref={input}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error !== null}
          aria-describedby={error ? "prompt-error" : undefined}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
        />
        {error && (
          <p className="prompt-error" id="prompt-error" role="alert">
            {error}
          </p>
        )}
        <div className="prompt-actions">
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim() || busy}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
