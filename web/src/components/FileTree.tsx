import { useMemo, useRef, useState } from "react"
import type { FileEntry } from "../bridge"
import {
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  FileIcon,
  FolderIcon,
  InfoIcon,
  MoreIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SortIcon,
  XIcon
} from "./Icons"
import { ActionSheet, Sheet } from "./Sheet"

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

export type SortMode =
  | "name-asc"
  | "name-desc"
  | "size-desc"
  | "size-asc"
  | "mtime-desc"
  | "ext"

const BINARY_EXTENSIONS = new Set([
  "apk", "apks", "xapk", "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar",
  "mp4", "mkv", "avi", "mov", "webm", "weba", "flv", "wmv", "3gp",
  "mp3", "wav", "flac", "ogg", "m4a", "aac", "wma", "opus",
  "jpg", "jpeg", "png", "gif", "webp", "bmp", "ico", "tiff", "psd",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "so", "dex", "o", "a", "class", "bin", "exe", "iso", "dmg", "jar"
])

function parentOf(path: string) {
  if (path.startsWith("/")) {
    const lastSlash = path.lastIndexOf("/")
    if (lastSlash <= 0) return "/"
    return path.slice(0, lastSlash)
  }
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
  if (path.startsWith("/")) {
    const parts = path.split("/").filter(Boolean)
    const out = [{ label: "root", path: "/" }]
    let current = ""
    for (const part of parts) {
      current = `${current}/${part}`
      out.push({ label: part, path: current })
    }
    return out
  }
  const parts = path.split("/")
  const out = [{ label: "workspace", path: "." }]
  let current = ""
  for (const part of parts) {
    current = current ? `${current}/${part}` : part
    out.push({ label: part, path: current })
  }
  return out
}

function getFileTypeDesc(entry: FileEntry): string {
  if (entry.kind === "dir") return "Folder / Directory"
  const dot = entry.name.lastIndexOf(".")
  if (dot === -1) return "Plain Document"
  const ext = entry.name.slice(dot).toLowerCase()
  const map: Record<string, string> = {
    ".py": "Python Source Code (.py)",
    ".php": "PHP Script (.php)",
    ".js": "JavaScript File (.js)",
    ".jsx": "React JSX File (.jsx)",
    ".ts": "TypeScript Source (.ts)",
    ".tsx": "React TSX Component (.tsx)",
    ".json": "JSON Document (.json)",
    ".html": "HTML Document (.html)",
    ".htm": "HTML Document (.htm)",
    ".css": "CSS Stylesheet (.css)",
    ".sh": "Shell Script (.sh)",
    ".bash": "Bash Script (.bash)",
    ".zsh": "Zsh Script (.zsh)",
    ".java": "Java Source Code (.java)",
    ".c": "C Source Code (.c)",
    ".cpp": "C++ Source Code (.cpp)",
    ".h": "C/C++ Header (.h)",
    ".hpp": "C++ Header (.hpp)",
    ".rs": "Rust Source Code (.rs)",
    ".sql": "SQL Script (.sql)",
    ".xml": "XML Document (.xml)",
    ".svg": "SVG Vector Graphic (.svg)",
    ".yaml": "YAML Document (.yaml)",
    ".yml": "YAML Document (.yml)",
    ".md": "Markdown Document (.md)",
    ".txt": "Text File (.txt)",
    ".env": "Environment Config (.env)",
    ".apk": "Android Application Package (.apk)",
    ".zip": "ZIP Archive (.zip)",
    ".mp4": "MPEG-4 Video (.mp4)",
    ".mp3": "MP3 Audio (.mp3)"
  }
  return map[ext] || `${ext.slice(1).toUpperCase()} File`
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
  const [propertiesFor, setPropertiesFor] = useState<FileEntry | null>(null)
  const [search, setSearch] = useState("")
  const [searchOpen, setSearchOpen] = useState(false)
  const [sortSheetOpen, setSortSheetOpen] = useState(false)
  const [sortBy, setSortBy] = useState<SortMode>(() => {
    return (localStorage.getItem("leocode.sortBy") as SortMode) || "name-asc"
  })
  const [filterBinary, setFilterBinary] = useState<boolean>(() => {
    const v = localStorage.getItem("leocode.filterBinary")
    return v === null ? true : v === "true"
  })
  const [showHidden, setShowHidden] = useState<boolean>(() => {
    return localStorage.getItem("leocode.showHidden") === "true"
  })

  const timer = useRef<number | null>(null)
  const longPressed = useRef(false)

  const trail = useMemo(() => crumbs(path), [path])

  const handleSetSort = (mode: SortMode) => {
    setSortBy(mode)
    localStorage.setItem("leocode.sortBy", mode)
    setSortSheetOpen(false)
  }

  const handleToggleFilterBinary = () => {
    setFilterBinary((prev) => {
      const next = !prev
      localStorage.setItem("leocode.filterBinary", String(next))
      return next
    })
  }

  const handleToggleShowHidden = () => {
    setShowHidden((prev) => {
      const next = !prev
      localStorage.setItem("leocode.showHidden", String(next))
      return next
    })
  }

  const filteredEntries = useMemo(() => {
    let list = entries

    // 1. Hidden files filter (starts with .)
    if (!showHidden) {
      list = list.filter((e) => !e.name.startsWith("."))
    }

    // 2. Binary / unrelated files filter
    if (filterBinary) {
      list = list.filter((e) => {
        if (e.kind === "dir") return true
        const ext = e.name.split(".").pop()?.toLowerCase()
        return !ext || !BINARY_EXTENSIONS.has(ext)
      })
    }

    // 3. Search query filter
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((e) => e.name.toLowerCase().includes(q))
    }

    // 4. Sort
    return [...list].sort((a, b) => {
      // Folders always first unless sorting by size/date specifically
      if (a.kind !== b.kind) {
        return a.kind === "dir" ? -1 : 1
      }
      switch (sortBy) {
        case "name-asc":
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
        case "name-desc":
          return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" })
        case "size-desc":
          return (b.size || 0) - (a.size || 0)
        case "size-asc":
          return (a.size || 0) - (b.size || 0)
        case "mtime-desc":
          return (b.mtime || 0) - (a.mtime || 0)
        case "ext": {
          const extA = a.name.split(".").pop()?.toLowerCase() || ""
          const extB = b.name.split(".").pop()?.toLowerCase() || ""
          return extA.localeCompare(extB) || a.name.localeCompare(b.name)
        }
        default:
          return a.name.localeCompare(b.name)
      }
    })
  }, [entries, search, sortBy, filterBinary, showHidden])

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
          <button
            className={"icon-btn tiny" + (searchOpen ? " active" : "")}
            onClick={() => {
              setSearchOpen((o) => !o)
              if (searchOpen) setSearch("")
            }}
            title="Search files"
            aria-label="Search files"
          >
            <SearchIcon size={16} />
          </button>
          <button
            className="icon-btn tiny"
            onClick={() => setSortSheetOpen(true)}
            title="Sort files"
            aria-label="Sort files"
          >
            <SortIcon size={16} />
          </button>
          <button
            className={"icon-btn tiny" + (filterBinary ? " active" : "")}
            onClick={handleToggleFilterBinary}
            title={filterBinary ? "Filtered: Code/Text only (tap to show all)" : "Showing all files (tap to hide binary/media)"}
            aria-label="Toggle binary filter"
          >
            {filterBinary ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </button>
          <button className="icon-btn tiny" onClick={() => onCreate("file")} title="New file" aria-label="New file">
            <PlusIcon size={16} />
          </button>
          <button
            className="icon-btn tiny"
            onClick={onRefresh}
            title="Refresh folder"
            aria-label="Refresh"
            disabled={loading}
          >
            <RefreshIcon size={16} className={loading ? "spin" : undefined} />
          </button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      {searchOpen && (
        <div className="file-search-bar">
          <SearchIcon size={15} className="file-search-icon" />
          <input
            type="text"
            className="file-search-input"
            placeholder="Filter files in directory…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button className="file-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
              <XIcon size={14} />
            </button>
          )}
        </div>
      )}

      {/* Active Filter Pills Bar */}
      {(filterBinary || showHidden || search) && (
        <div className="files-status-pills">
          {filterBinary && (
            <span className="file-pill" onClick={handleToggleFilterBinary}>
              Code only ({filteredEntries.length}) <span className="pill-x">×</span>
            </span>
          )}
          {showHidden && (
            <span className="file-pill accent" onClick={handleToggleShowHidden}>
              Showing .hidden <span className="pill-x">×</span>
            </span>
          )}
          {!showHidden && (
            <button className="pill-btn-toggle" onClick={handleToggleShowHidden}>
              + Show .hidden
            </button>
          )}
          {search && (
            <span className="file-pill search">
              Filter: "{search}" ({filteredEntries.length})
            </span>
          )}
        </div>
      )}

      {path !== "." && (
        <button className="row up-row" onClick={() => onNavigate(parentOf(path))}>
          <span className="row-icon">..</span>
          <span className="row-name">Parent folder</span>
        </button>
      )}

      <ul className="entry-list">
        {filteredEntries.map((entry) => (
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

      {!loading && filteredEntries.length === 0 && (
        <div className="empty">
          <p>{search ? "No files matching search." : filterBinary ? "No code or text files found in this folder." : "This folder is empty."}</p>
          {filterBinary && !search && (
            <button className="btn ghost" onClick={handleToggleFilterBinary}>
              Show All Files ({entries.length})
            </button>
          )}
          {!search && !filterBinary && (
            <button className="btn ghost" onClick={() => onCreate("file")}>
              Create a file
            </button>
          )}
        </div>
      )}

      {/* Context Actions Sheet */}
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
            label: "Properties",
            icon: <InfoIcon size={18} />,
            onSelect: () => {
              const target = sheetFor
              if (target) setPropertiesFor(target)
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

      {/* Sort Options Sheet */}
      <ActionSheet
        open={sortSheetOpen}
        onClose={() => setSortSheetOpen(false)}
        title="Sort Files By"
        actions={[
          {
            label: "Name (A to Z)" + (sortBy === "name-asc" ? " ✓" : ""),
            onSelect: () => handleSetSort("name-asc")
          },
          {
            label: "Name (Z to A)" + (sortBy === "name-desc" ? " ✓" : ""),
            onSelect: () => handleSetSort("name-desc")
          },
          {
            label: "Size (Largest first)" + (sortBy === "size-desc" ? " ✓" : ""),
            onSelect: () => handleSetSort("size-desc")
          },
          {
            label: "Size (Smallest first)" + (sortBy === "size-asc" ? " ✓" : ""),
            onSelect: () => handleSetSort("size-asc")
          },
          {
            label: "Date Modified (Newest first)" + (sortBy === "mtime-desc" ? " ✓" : ""),
            onSelect: () => handleSetSort("mtime-desc")
          },
          {
            label: "File Extension / Type" + (sortBy === "ext" ? " ✓" : ""),
            onSelect: () => handleSetSort("ext")
          }
        ]}
      />

      {/* File / Folder Properties Sheet */}
      <Sheet
        open={propertiesFor !== null}
        onClose={() => setPropertiesFor(null)}
        title="Properties"
      >
        {propertiesFor && (
          <div className="properties-sheet">
            <div className="properties-group">
              <div className="property-item">
                <span className="property-label">Name</span>
                <span className="property-value font-mono">{propertiesFor.name}</span>
              </div>
              <div className="property-item">
                <span className="property-label">Type</span>
                <span className="property-value">{getFileTypeDesc(propertiesFor)}</span>
              </div>
              <div className="property-item">
                <span className="property-label">Size</span>
                <span className="property-value">
                  {formatSize(propertiesFor.size)} {propertiesFor.kind === "file" && `(${propertiesFor.size.toLocaleString()} bytes)`}
                </span>
              </div>
              <div className="property-item">
                <span className="property-label">Directory</span>
                <span className="property-value font-mono break-all">{parentOf(propertiesFor.path)}</span>
              </div>
              <div className="property-item">
                <span className="property-label">Full Path</span>
                <span className="property-value font-mono break-all">{propertiesFor.path}</span>
              </div>
              <div className="property-item">
                <span className="property-label">Last Modified</span>
                <span className="property-value">
                  {propertiesFor.mtime ? new Date(propertiesFor.mtime).toLocaleString() : "Unknown"}
                </span>
              </div>
            </div>
            <div className="properties-actions">
              <button className="btn primary block" onClick={() => setPropertiesFor(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </div>
  )
}
