import { useEffect, useRef, useState } from "react"
import { Sheet } from "./Sheet"

interface Props {
  open: boolean
  title: string
  label?: string
  initialValue?: string
  placeholder?: string
  confirmLabel?: string
  onConfirm: (value: string) => void
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
  const input = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!open) return
    setValue(initialValue)
    const timer = window.setTimeout(() => {
      input.current?.focus()
      input.current?.select()
    }, 120)
    return () => window.clearTimeout(timer)
  }, [open, initialValue])

  const submit = () => {
    const trimmed = value.trim()
    if (!trimmed) return
    onConfirm(trimmed)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <form
        className="prompt"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
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
          onChange={(event) => setValue(event.target.value)}
        />
        <div className="prompt-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
