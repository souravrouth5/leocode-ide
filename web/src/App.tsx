import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { createBridge } from "./bridge"
import type { FileEntry, OpenFile } from "./bridge"
import { EditorPane } from "./components/EditorPane"
import { FileTree } from "./components/FileTree"
import { StatusBar } from "./components/StatusBar"

// xterm + its CSS are only needed on the terminal tab.
const TerminalPane = lazy(() =>
  import("./components/TerminalPane").then((module) => ({ default: module.TerminalPane }))
)

type View = "files" | "editor" | "terminal" | "git"

const VIEWS: Array<{ id: View; label: string; icon: string }> = [
  { id: "files", label: "Files", icon: "🗂" },
  { id: "editor", label: "Editor", icon: "⌨" },
  { id: "terminal", label: "Terminal", icon: "»_" },
  { id: "git", label: "Git", icon: "⑂" }
]

export default function App() {
  const bridge = useMemo(createBridge, [])
  const [view, setView] = useState<View>("editor")
  const [cwd, setCwd] = useState(".")
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setEntries(await bridge.list(cwd))
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [bridge, cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const openFile = useCallback(
    async (entry: FileEntry) => {
      if (entry.kind !== "file") return
      const existing = openFiles.find((f) => f.path === entry.path)
      if (existing) {
        setActivePath(entry.path)
        setView("editor")
        return
      }
      try {
        const content = await bridge.read(entry.path)
        setOpenFiles((files) => [...files, { path: entry.path, content, dirty: false }])
        setActivePath(entry.path)
        setView("editor")
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [bridge, openFiles]
  )

  const updateActive = useCallback(
    (content: string) => {
      if (!activePath) return
      setOpenFiles((files) =>
        files.map((file) =>
          file.path === activePath && file.content !== content
            ? { ...file, content, dirty: true }
            : file
        )
      )
    },
    [activePath]
  )

  const saveActive = useCallback(async () => {
    if (!activePath) return
    const file = openFiles.find((f) => f.path === activePath)
    if (!file) return
    try {
      await bridge.write(file.path, file.content)
      setOpenFiles((files) =>
        files.map((f) => (f.path === file.path ? { ...f, dirty: false } : f))
      )
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [activePath, bridge, openFiles])

  const closeFile = useCallback(
    (path: string) => {
      setOpenFiles((files) => files.filter((f) => f.path !== path))
      if (activePath === path) {
        const remaining = openFiles.filter((f) => f.path !== path)
        setActivePath(remaining.length ? remaining[remaining.length - 1].path : null)
      }
    },
    [activePath, openFiles]
  )

  const active = openFiles.find((f) => f.path === activePath) ?? null
  const dirtyCount = openFiles.filter((f) => f.dirty).length

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> LeoCode
        </div>
        <div className="topbar-right">
          {dirtyCount > 0 && <span className="badge">{dirtyCount} unsaved</span>}
          <button className="chip" onClick={() => void saveActive()} disabled={!active?.dirty}>
            Save
          </button>
        </div>
      </header>

      {error && (
        <div className="error-bar" role="alert">
          {error}
          <button className="chip" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      <main className="workspace">
        {view === "files" && (
          <FileTree
            cwd={cwd}
            entries={entries}
            activePath={activePath}
            onOpen={(entry) => void openFile(entry)}
            onNavigate={setCwd}
            onRefresh={() => void refresh()}
          />
        )}

        {view === "editor" && (
          <div className="pane editor-pane">
            <div className="tab-strip">
              {openFiles.length === 0 && <span className="empty">No file open</span>}
              {openFiles.map((file) => (
                <div
                  key={file.path}
                  className={"tab" + (file.path === activePath ? " active" : "")}
                  onClick={() => setActivePath(file.path)}
                >
                  <span className="tab-name">{file.path.split("/").pop()}</span>
                  {file.dirty && <span className="dot" title="Unsaved changes" />}
                  <button
                    className="tab-close"
                    onClick={(event) => {
                      event.stopPropagation()
                      closeFile(file.path)
                    }}
                    title="Close"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {active ? (
              <>
                <div className="breadcrumb" title={active.path}>
                  {active.path.split("/").join(" › ")}
                </div>
                <EditorPane
                  key={active.path}
                  path={active.path}
                  initialContent={active.content}
                  onChange={updateActive}
                  onSave={() => void saveActive()}
                />
              </>
            ) : (
              <div className="empty-state">
                <p>Open a file from the Files tab.</p>
                <button className="primary" onClick={() => setView("files")}>
                  Browse files
                </button>
              </div>
            )}
          </div>
        )}

        {view === "terminal" && (
          <div className="pane terminal-pane">
            <Suspense fallback={<div className="empty">Loading terminal…</div>}>
              <TerminalPane bridge={bridge} cwd={cwd} onCwdChange={setCwd} />
            </Suspense>
          </div>
        )}

        {view === "git" && (
          <div className="pane">
            <div className="pane-head">
              <span className="path">Git</span>
            </div>
            <div className="empty-state">
              <p>
                Git UI lands in Phase 3 (JGit). The bridge methods are already defined in
                <code> docs/bridge-contract.md</code>.
              </p>
              <button className="primary" onClick={() => setView("terminal")}>
                Use the terminal for now
              </button>
            </div>
          </div>
        )}
      </main>

      <nav className="bottom-nav">
        {VIEWS.map((item) => (
          <button
            key={item.id}
            className={"nav-item" + (view === item.id ? " active" : "")}
            onClick={() => setView(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </button>
        ))}
      </nav>

      <StatusBar
        mode={bridge.mode}
        cwd={cwd}
        fileCount={entries.length}
        activePath={activePath}
      />
    </div>
  )
}
