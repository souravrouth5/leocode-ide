import type { FileEntry } from "../bridge"

interface Props {
  cwd: string
  entries: FileEntry[]
  activePath: string | null
  onOpen: (entry: FileEntry) => void
  onNavigate: (cwd: string) => void
  onRefresh: () => void
}

const ICON: Record<string, string> = {
  py: "🐍",
  md: "📝",
  json: "{}",
  ts: "TS",
  tsx: "TS",
  js: "JS",
  css: "#",
  html: "<>",
  gitignore: "◦"
}

function iconFor(entry: FileEntry): string {
  if (entry.kind === "dir") return "▸"
  const ext = entry.name.split(".").pop() ?? ""
  return ICON[ext] ?? ICON[entry.name] ?? "·"
}

export function FileTree({ cwd, entries, activePath, onOpen, onNavigate, onRefresh }: Props) {
  const up = () => {
    if (cwd === ".") return
    const parts = cwd.split("/")
    parts.pop()
    onNavigate(parts.length ? parts.join("/") : ".")
  }

  return (
    <div className="pane">
      <div className="pane-head">
        <button className="chip" onClick={up} disabled={cwd === "."} title="Parent folder">
          ↑
        </button>
        <span className="path" title={cwd}>
          /{cwd === "." ? "" : cwd}
        </span>
        <button className="chip" onClick={onRefresh} title="Refresh">
          ⟳
        </button>
      </div>

      <div className="file-list">
        {entries.length === 0 && <div className="empty">Empty folder</div>}
        {entries.map((entry) => (
          <button
            key={entry.path}
            className={
              "file-row" +
              (entry.path === activePath ? " active" : "") +
              (entry.kind === "dir" ? " dir" : "")
            }
            onClick={() => (entry.kind === "dir" ? onNavigate(entry.path) : onOpen(entry))}
          >
            <span className="file-icon">{iconFor(entry)}</span>
            <span className="file-name">{entry.name}</span>
            {entry.kind === "file" && entry.size > 0 && (
              <span className="file-meta">{formatSize(entry.size)}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
