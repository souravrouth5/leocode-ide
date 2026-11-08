import { useMemo, useRef, useState } from "react"
import type { FileEntry } from "../bridge"
import {
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  MoreIcon,
  PlusIcon,
  RefreshIcon
} from "./Icons"
import { ActionSheet } from "./Sheet"

interface Props {
  path: string
  entries: FileEntry[]
  loading: boolean
  onOpen: (entry: FileEntry) => void
  onNavigate: (path: string) => void
  onRefresh: () => void
  onCreate: (kind: "file" | "dir") => void
  onRename: (entry: FileEntry) => void
  onDelete: (entry: FileEntry) => void
}

function parentOf(path: string) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "."
}

function formatSize(bytes: number) {
  if (!bytes) return ""
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function crumbs(path: string) {
  if (path === ".") return [{ label: "workspace", path: "." }]
  const parts = path.split("/")
  const out = [{ label: "workspace", path: "." }]
  let current = ""
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    out.push({ label: part, path: current })
  }
  return out
}

export function FileTree({
  path,
  entries,
  loading,
  onOpen,
  onNavigate,
  onRefresh,
  onCreate,
  onRename,
  onDelete
}: Props) {
  const [sheetFor, setSheetFor] = useState<FileEntry | null>(null)
  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const trail = useMemo(() => crumbs(path), [path])

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }

  const startPress = (entry: FileEntry) => {
    longPressed.current = false
    clearTimer()
    timer.current = window.setTimeout(() => {
      longPressed.current = true
      if (navigator.vibrate) navigator.vibrate(12)
      setSheetFor(entry)
    }, 420)
  }

  const endPress = (entry: FileEntry) => {
    clearTimer()
    if (longPressed.current) {
      longPressed.current = false
      return
    }
    if (entry.kind === "dir") onNavigate(entry.path)
    else onOpen(entry)
  }

  return (
    <div className="files">
      <div className="files-toolbar">
        <div className="crumbs">
          {trail.map((crumb, index) => (
            <span key={crumb.path} className="crumb-wrap">
              {index > 0 && <ChevronRightIcon size={12} className="crumb-sep" />}
              <button
                className={
                  "crumb" + (index === trail.length - 1 ? " current" : "")
                }
                onClick={() => onNavigate(crumb.path)}
              >
                {crumb.label}
              </button>
            </span>
          ))}
        </div>
        <div className="files-actions">
          <button className="icon-btn" onClick={() => onCreate("file")} aria-label="New file">
            <PlusIcon size={18} />
          </button>
          <button
            className="icon-btn"
            onClick={onRefresh}
            aria-label="Refresh"
            disabled={loading}
          >
            <RefreshIcon size={18} className={loading ? "spin" : undefined} />
          </button>
        </div>
      </div>

      {path !== "." && (
        <button className="row up-row" onClick={() => onNavigate(parentOf(path))}>
          <span className="row-icon">..</span>
          <span className="row-name">Parent folder</span>
        </button>
      )}

      <ul className="entry-list">
        {entries.map((entry) => (
          <li key={entry.path} className="entry">
            <button
              className="row-main"
              onPointerDown={() => startPress(entry)}
              onPointerUp={() => endPress(entry)}
              onPointerCancel={clearTimer}
              onPointerLeave={clearTimer}
              onContextMenu={(event) => {
                event.preventDefault()
                setSheetFor(entry)
              }}
            >
              <span className={"row-icon " + (entry.kind === "dir" ? "dir" : "file")}>
                {entry.kind === "dir" ? <FolderIcon size={19} /> : <FileIcon size={19} />}
              </span>
              <span className="row-name">{entry.name}</span>
              <span className="row-meta">{formatSize(entry.size)}</span>
            </button>
            <button
              className="row-more"
              aria-label={`Actions for ${entry.name}`}
              onClick={() => {
                clearTimer()
                setSheetFor(entry)
              }}
            >
              <MoreIcon size={16} />
            </button>
          </li>
        ))}
      </ul>

      {!loading && entries.length === 0 && (
        <div className="empty">
          <p>This folder is empty.</p>
          <button className="btn ghost" onClick={() => onCreate("file")}>
            Create a file
          </button>
        </div>
      )}

      <ActionSheet
        open={sheetFor !== null}
        onClose={() => setSheetFor(null)}
        title={sheetFor?.name}
        actions={[
          {
            label: sheetFor?.kind === "dir" ? "Open folder" : "Open file",
            icon: sheetFor?.kind === "dir" ? <FolderIcon size={18} /> : <FileIcon size={18} />,
            onSelect: () => {
              const target = sheetFor
              if (!target) return
              if (target.kind === "dir") onNavigate(target.path)
              else onOpen(target)
            }
          },
          {
            label: "New file here",
            icon: <PlusIcon size={18} />,
            onSelect: () => onCreate("file")
          },
          {
            label: "Rename",
            icon: (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" />
              </svg>
            ),
            onSelect: () => {
              const target = sheetFor
              if (target) onRename(target)
            }
          },
          {
            label: "Delete",
            destructive: true,
            icon: (
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13" />
              </svg>
            ),
            onSelect: () => {
              const target = sheetFor
              if (target) onDelete(target)
            }
          }
        ]}
      />
    </div>
  )
}
