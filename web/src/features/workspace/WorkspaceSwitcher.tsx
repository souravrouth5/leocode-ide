import { useEffect, useRef, useState } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { FolderIcon, MoreVerticalIcon } from "../../components/Icons"

/**
 * Top-bar workspace switcher (Task 14). Shows the active project and offers the
 * recent list, create, rename and delete. The destructive action is confirmed by
 * the store; the host moves the directory to the trash.
 */
export function WorkspaceSwitcher() {
  const { workspace } = useStores()
  const workspaces = useStore(workspace, (state) => state.workspaces)
  const activeId = useStore(workspace, (state) => state.activeId)
  const busy = useStore(workspace, (state) => state.busy)
  const [open, setOpen] = useState(false)
  const host = useRef<HTMLDivElement | null>(null)
  const active = workspaces.find((item) => item.id === activeId) ?? workspaces[0] ?? null

  useEffect(() => {
    if (!open) return
    const close = (event: Event) => {
      if (host.current && !host.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener("mousedown", close)
    window.addEventListener("touchstart", close)
    return () => {
      window.removeEventListener("mousedown", close)
      window.removeEventListener("touchstart", close)
    }
  }, [open])

  const create = () => {
    const name = window.prompt("Name for the new workspace:", "Project")
    if (!name?.trim()) return
    void workspace.getState().create(name).then((ok) => {
      if (ok) setOpen(false)
    })
  }

  const rename = () => {
    if (!active) return
    const name = window.prompt("Rename workspace:", active.name)
    if (!name?.trim() || name.trim() === active.name) return
    void workspace.getState().rename(active.id, name).then((ok) => {
      if (ok) setOpen(false)
    })
  }

  const remove = () => {
    if (!active || active.id === "default") return
    void workspace.getState().remove(active.id).then((ok) => {
      if (ok) setOpen(false)
    })
  }

  return (
    <div className="workspace-switcher" ref={host}>
      <button
        className="workspace-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        title="Switch workspace"
      >
        <FolderIcon size={15} />
        <span className="workspace-name">{active?.name ?? "Workspace"}</span>
        <MoreVerticalIcon size={14} />
      </button>
      {open && (
        <div className="workspace-menu" role="menu">
          <div className="workspace-menu-label">Recent workspaces</div>
          {workspaces.map((item) => (
            <button
              key={item.id}
              className={"workspace-row" + (item.id === activeId ? " active" : "")}
              role="menuitem"
              disabled={busy}
              onClick={() => {
                setOpen(false)
                void workspace.getState().open(item.id)
              }}
            >
              <span className="workspace-row-name">{item.name}</span>
              <span className="workspace-row-meta">
                {item.id === "default" ? "Default" : new Date(item.lastOpened).toLocaleDateString()}
              </span>
              {item.id === activeId && <span className="workspace-check">✓</span>}
            </button>
          ))}
          <div className="menu-divider" />
          <button className="menu-item" onClick={create} disabled={busy}>
            <span>New workspace…</span>
          </button>
          <button className="menu-item" onClick={rename} disabled={busy || !active}>
            <span>Rename current…</span>
          </button>
          <button
            className="menu-item danger"
            onClick={remove}
            disabled={busy || !active || active.id === "default"}
          >
            <span>Delete current…</span>
          </button>
        </div>
      )}
    </div>
  )
}
