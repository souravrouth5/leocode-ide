import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createBridge, type AppInfo, type Bridge, type FileEntry, type ThemeState } from "./bridge"
import { FileTree } from "./components/FileTree"
import {
  CodeIcon,
  FolderIcon,
  MoonIcon,
  MonitorIcon,
  SaveIcon,
  SettingsIcon,
  SunIcon,
  TerminalIcon,
  XIcon
} from "./components/Icons"
import { PromptDialog } from "./components/PromptDialog"
import { ActionSheet, Sheet } from "./components/Sheet"
import { StatusBar } from "./components/StatusBar"
import { ThemeProvider, useTheme } from "./theme/ThemeProvider"

// CodeMirror and xterm are ~200 KB of JS; fetch each only when it is first used
// so the file browser paints immediately after launch.
const EditorPane = lazy(() =>
  import("./components/EditorPane").then((module) => ({ default: module.EditorPane }))
)
const TerminalPane = lazy(() =>
  import("./components/TerminalPane").then((module) => ({ default: module.TerminalPane }))
)

type View = "files" | "editor" | "terminal"

interface OpenDoc {
  path: string
  content: string
  /** Last content written to disk; `content !== saved` means unsaved changes. */
  saved: string
}

const isDirty = (doc: OpenDoc) => doc.content !== doc.saved

const join = (base: string, name: string) => (base === "." ? name : `${base}/${name}`)

const baseName = (path: string) => path.split("/").pop() ?? path

const dirName = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "."

// --------------------------------------------------------------------- boot

export default function App() {
  useEffect(() => {
    document.getElementById("boot")?.remove()
  }, [])

  const [ready, setReady] = useState<
    { bridge: Bridge; info: AppInfo | null } | { error: string } | null
  >(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await createBridge()
      if (cancelled) return
      if ("error" in result) {
        setReady({ error: result.error })
        return
      }
      let info: AppInfo | null = null
      try {
        info = await result.bridge.info()
      } catch {
        // The bridge answered createBridge's ping; info is a nicety.
      }
      if (!cancelled) setReady({ bridge: result.bridge, info })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!ready) return <Splash />
  if ("error" in ready) return <BootError message={ready.error} />

  const theme: ThemeState | null = ready.info?.theme ?? null
  return (
    <ThemeProvider bridge={ready.bridge} initial={theme}>
      <Shell bridge={ready.bridge} info={ready.info} />
    </ThemeProvider>
  )
}

function Splash() {
  return (
    <div className="splash">
      <div className="splash-mark">{"</>"}</div>
      <div className="splash-name">LeoCode</div>
      <div className="splash-note">Starting the workspace…</div>
    </div>
  )
}

function BootError({ message }: { message: string }) {
  return (
    <div className="splash">
      <div className="splash-mark warn">!</div>
      <div className="splash-name">Bridge unavailable</div>
      <p className="splash-note">{message}</p>
    </div>
  )
}

// -------------------------------------------------------------------- shell

function Shell({ bridge, info }: { bridge: Bridge; info: AppInfo | null }) {
  const { mode, effective, setMode } = useTheme()
  const dark = effective === "dark"

  const [view, setView] = useState<View>("files")
  const [cwd, setCwd] = useState(".")
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [docs, setDocs] = useState<OpenDoc[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<
    | null
    | {
        title: string
        label: string
        initial: string
        kind: "file" | "dir" | "rename"
        target?: FileEntry
      }
  >(null)
  const [error, setError] = useState<string | null>(null)

  const messageTimer = useRef<number | null>(null)
  const flash = useCallback((text: string) => {
    setMessage(text)
    if (messageTimer.current !== null) window.clearTimeout(messageTimer.current)
    messageTimer.current = window.setTimeout(() => setMessage(null), 2200)
  }, [])

  const activeDoc = docs.find((doc) => doc.path === activePath) ?? null
  const activeDirty = activeDoc ? isDirty(activeDoc) : false

  // --------------------------------------------------------------- files

  const refresh = useCallback(
    async (target = cwd) => {
      setLoading(true)
      try {
        const list = await bridge.list(target)
        setEntries(list)
        setError(null)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setLoading(false)
      }
    },
    [bridge, cwd]
  )

  useEffect(() => {
    void refresh(cwd)
  }, [cwd, refresh])

  const openFile = useCallback(
    async (entry: FileEntry | string) => {
      const path = typeof entry === "string" ? entry : entry.path
      const existing = docs.find((doc) => doc.path === path)
      if (existing) {
        setActivePath(path)
        setView("editor")
        return
      }
      try {
        const content = await bridge.read(path)
        setDocs((current) => [...current, { path, content, saved: content }])
        setActivePath(path)
        setView("editor")
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [bridge, docs]
  )

  const save = useCallback(
    async (path = activePath) => {
      if (!path) return
      const doc = docs.find((item) => item.path === path)
      if (!doc) return
      try {
        await bridge.write(path, doc.content)
        setDocs((current) =>
          current.map((item) =>
            item.path === path ? { ...item, saved: item.content } : item
          )
        )
        flash("Saved")
        if (dirName(path) === cwd) void refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [activePath, bridge, cwd, docs, flash, refresh]
  )

  const closeDoc = useCallback(
    (path: string) => {
      const doc = docs.find((item) => item.path === path)
      if (doc && isDirty(doc) && !window.confirm(`Discard unsaved changes to ${baseName(path)}?`)) {
        return
      }
      setDocs((current) => {
        const next = current.filter((item) => item.path !== path)
        if (path === activePath) {
          setActivePath(next.length ? next[next.length - 1].path : null)
        }
        return next
      })
    },
    [activePath, docs]
  )

  const handlePrompt = useCallback(
    async (value: string) => {
      if (!prompt) return
      try {
        if (prompt.kind === "rename" && prompt.target) {
          const target = join(dirName(prompt.target.path), value)
          await bridge.rename(prompt.target.path, target)
          setDocs((current) =>
            current.map((item) =>
              item.path === prompt.target!.path ? { ...item, path: target } : item
            )
          )
          setActivePath((current) => (current === prompt.target!.path ? target : current))
          flash("Renamed")
        } else if (prompt.kind === "dir") {
          await bridge.mkdir(join(cwd, value))
          flash("Folder created")
        } else {
          const path = join(cwd, value)
          await bridge.write(path, "")
          flash("File created")
          await refresh()
          await openFile(path)
          return
        }
        await refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [bridge, cwd, flash, openFile, prompt, refresh]
  )

  const deleteEntry = useCallback(
    async (entry: FileEntry) => {
      const ok = window.confirm(
        entry.kind === "dir"
          ? `Delete the folder "${entry.name}" and everything in it?`
          : `Delete "${entry.name}"?`
      )
      if (!ok) return
      try {
        await bridge.remove(entry.path)
        setDocs((current) =>
          current.filter(
            (doc) => doc.path !== entry.path && !doc.path.startsWith(entry.path + "/")
          )
        )
        flash("Deleted")
        await refresh()
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [bridge, flash, refresh]
  )

  // ------------------------------------------------------------- hardware

  useEffect(() => {
    window.__leocodeBack = () => {
      if (prompt || settingsOpen) {
        setPrompt(null)
        setSettingsOpen(false)
        return true
      }
      if (view !== "files") {
        setView("files")
        return true
      }
      return false
    }
    return () => {
      delete window.__leocodeBack
    }
  }, [prompt, settingsOpen, view])

  const go = (next: View) => {
    if (next === "terminal") setTerminalMounted(true)
    setView(next)
  }

  const cycleTheme = () => {
    setMode(mode === "system" ? "light" : mode === "light" ? "dark" : "system")
  }

  const ThemeIcon = mode === "system" ? MonitorIcon : mode === "light" ? SunIcon : MoonIcon
  const themeLabel =
    mode === "system" ? `System (${effective})` : mode === "light" ? "Light" : "Dark"

  const statusPath = view === "editor" ? activePath ?? "." : cwd

  return (
    <div className={"app" + (view === "editor" ? " view-editor" : "")}>
      <header className="app-bar">
        <div className="brand">
          <span className="brand-mark">{"</>"}</span>
          <span className="brand-name">LeoCode</span>
        </div>
        <div className="app-bar-actions">
          {activeDoc && (
            <button
              className={"icon-btn save" + (activeDirty ? " armed" : "")}
              onClick={() => void save()}
              disabled={!activeDirty}
              aria-label={activeDirty ? "Save file" : "No unsaved changes"}
              title={activeDirty ? "Save" : "Saved"}
            >
              <SaveIcon size={19} />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={cycleTheme}
            aria-label={`Theme: ${themeLabel}`}
            title={`Theme: ${themeLabel}`}
          >
            <ThemeIcon size={19} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <SettingsIcon size={19} />
          </button>
        </div>
      </header>

      <main className="views">
        <section
          className={"view" + (view === "files" ? " current" : "")}
          aria-hidden={view !== "files"}
        >
          <FileTree
            path={cwd}
            entries={entries}
            loading={loading}
            onOpen={openFile}
            onNavigate={setCwd}
            onRefresh={() => void refresh()}
            onCreate={(kind) =>
              setPrompt({
                kind,
                title: kind === "dir" ? "New folder" : "New file",
                label: kind === "dir" ? "Folder name" : "File name",
                initial: ""
              })
            }
            onRename={(entry) =>
              setPrompt({
                kind: "rename",
                title: "Rename",
                label: "New name",
                initial: entry.name,
                target: entry
              })
            }
            onDelete={(entry) => void deleteEntry(entry)}
          />
        </section>

        <section
          className={"view editor-view" + (view === "editor" ? " current" : "")}
          aria-hidden={view !== "editor"}
        >
          {docs.length > 0 && (
            <div className="tabs" role="tablist">
              {docs.map((doc) => (
                <div
                  key={doc.path}
                  className={
                    "tab" +
                    (doc.path === activePath ? " active" : "") +
                    (isDirty(doc) ? " dirty" : "")
                  }
                  role="tab"
                  aria-selected={doc.path === activePath}
                  onClick={() => {
                    setActivePath(doc.path)
                    setView("editor")
                  }}
                >
                  <span className="tab-name">{baseName(doc.path)}</span>
                  <button
                    className="tab-close"
                    aria-label={`Close ${baseName(doc.path)}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      closeDoc(doc.path)
                    }}
                  >
                    <XIcon size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {activeDoc ? (
            <div className="editor-body">
              <Suspense fallback={<div className="empty">Loading editor…</div>}>
                <EditorPane
                key={activeDoc.path}
                path={activeDoc.path}
                initialContent={activeDoc.content}
                dark={dark}
                onChange={(content) =>
                  setDocs((current) =>
                    current.map((item) =>
                      item.path === activeDoc.path ? { ...item, content } : item
                    )
                  )
                }
                  onSave={() => void save()}
                />
              </Suspense>
            </div>
          ) : (
            <div className="empty editor-empty">
              <CodeIcon size={28} />
              <p>No file open</p>
              <button className="btn ghost" onClick={() => go("files")}>
                Browse files
              </button>
            </div>
          )}
        </section>

        {terminalMounted && (
          <section
            className={"view terminal-view" + (view === "terminal" ? " current" : "")}
            aria-hidden={view !== "terminal"}
          >
            <Suspense fallback={<div className="empty">Loading terminal…</div>}>
              <TerminalPane
                bridge={bridge}
                cwd={cwd}
                active={view === "terminal"}
                dark={dark}
              />
            </Suspense>
          </section>
        )}
      </main>

      <StatusBar
        mode={bridge.mode}
        path={error ? "error" : statusPath}
        dirty={activeDirty}
        message={error ?? message}
      />

      <nav className="tabbar" aria-label="Main">
        {(
          [
            { id: "files", label: "Files", Icon: FolderIcon },
            { id: "editor", label: "Editor", Icon: CodeIcon },
            { id: "terminal", label: "Terminal", Icon: TerminalIcon }
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={"tabbar-item" + (view === id ? " active" : "")}
            onClick={() => go(id)}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <Sheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Settings"
      >
        <div className="settings">
          <div className="settings-group">
            <h3>Appearance</h3>
            {(
              [
                { id: "system", label: "Follow system", Icon: MonitorIcon },
                { id: "light", label: "Light", Icon: SunIcon },
                { id: "dark", label: "Dark", Icon: MoonIcon }
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                className={"choice" + (mode === id ? " selected" : "")}
                onClick={() => setMode(id)}
              >
                <Icon size={18} />
                <span>{label}</span>
                <span className="choice-check">{mode === id ? "✓" : ""}</span>
              </button>
            ))}
          </div>

          <div className="settings-group">
            <h3>About</h3>
            <dl className="facts">
              <dt>Bridge</dt>
              <dd>{bridge.mode}</dd>
              <dt>Version</dt>
              <dd>{info?.version ?? "dev"}</dd>
              {info?.androidRelease && (
                <>
                  <dt>Android</dt>
                  <dd>{info.androidRelease}</dd>
                </>
              )}
              {info?.webview && (
                <>
                  <dt>WebView</dt>
                  <dd>{info.webview}</dd>
                </>
              )}
              {info?.workspace && (
                <>
                  <dt>Workspace</dt>
                  <dd className="mono">{info.workspace}</dd>
                </>
              )}
            </dl>
          </div>
        </div>
      </Sheet>

      <PromptDialog
        open={prompt !== null}
        title={prompt?.title ?? ""}
        label={prompt?.label}
        initialValue={prompt?.initial ?? ""}
        confirmLabel={prompt?.kind === "rename" ? "Rename" : "Create"}
        onClose={() => setPrompt(null)}
        onConfirm={(value) => void handlePrompt(value)}
      />

      <ActionSheet
        open={error !== null}
        title="Something went wrong"
        onClose={() => setError(null)}
        actions={[
          {
            label: "Dismiss",
            onSelect: () => setError(null)
          }
        ]}
      />
    </div>
  )
}
