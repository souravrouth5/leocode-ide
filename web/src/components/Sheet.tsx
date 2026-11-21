import { useEffect, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { XIcon } from "./Icons"

interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}

export function Sheet({ open, onClose, title, children }: SheetProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  return createPortal(
    <>
      <div
        className={"sheet-backdrop" + (open ? " is-open" : "")}
        onClick={onClose}
        aria-hidden={!open}
      />
      {/* A closed sheet is off-screen but still mounted; hide it from assistive
          tech (and role queries) so its live regions stay inert. */}
      <section
        className={"sheet" + (open ? " is-open" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
      >
        <div className="sheet-grip" />
        {title && (
          <header className="sheet-head">
            <h2>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <XIcon size={18} />
            </button>
          </header>
        )}
        <div className="sheet-body">{children}</div>
      </section>
    </>,
    document.body
  )
}

export interface SheetAction {
  label: string
  icon?: ReactNode
  destructive?: boolean
  onSelect: () => void
}

export function ActionSheet({
  open,
  title,
  actions,
  onClose
}: {
  open: boolean
  title?: string
  actions: SheetAction[]
  onClose: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="action-list">
        {actions.map((action) => (
          <button
            key={action.label}
            className={"action-row" + (action.destructive ? " destructive" : "")}
            onClick={() => {
              action.onSelect()
              onClose()
            }}
          >
            <span className="action-icon">{action.icon}</span>
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}
