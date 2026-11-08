import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createBridge, type AppInfo, type Bridge, type FileEntry, type ProcessEvent, type RunHandle, type ThemeState } from "./bridge"
import { FileTree } from "./components/FileTree"
import {
  CodeIcon,
  CpuIcon,
  FolderIcon,
  LeoCodeLogo,
  MenuIcon,
  MoonIcon,
  MonitorIcon,
  PlayIcon,
  RefreshIcon,
  SaveIcon,
  SettingsIcon,
  SunIcon,
  TerminalIcon,
  XIcon
} from "./components/Icons"
import { PromptDialog } from "./components/PromptDialog"
import { RunSheet, type RunSegment } from "./components/RunSheet"
import { ActionSheet, Sheet } from "./components/Sheet"
import { SettingsDialog } from "./components/SettingsDialog"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { useUserSettings } from "./settings/userSettings"
import { ThemeProvider, useTheme } from "./theme/ThemeProvider"

// CodeMirror, xterm, and runtime manager are code-split
const EditorPane = lazy(() =>
  import("./components/EditorPane").then((module) => ({ default: module.EditorPane }))
)
const TerminalPane = lazy(() =>
  import("./components/TerminalPane").then((module) => ({ default: module.TerminalPane }))
)
const RuntimeManager = lazy(() =>
  import("./components/RuntimeManager").then((module) => ({ default: module.RuntimeManager }))
)

type View = "files" | "editor" | "terminal" | "runtimes"

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

/** Output kept per run; the beginning is dropped when a program is chatty. */
const RUN_LIMIT = 200_000

const PYTHON_HINT =
  "Python is not installed on this device yet. The bundled CPython runtime is the next milestone — use the Terminal for shell work until then."

const runKind = (path: string): "python" | "shell" | null => {
  const lower = path.toLowerCase()
  if (lower.endsWith(".py")) return "python"
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "shell"
  return null
}

interface RunState {
  title: string
  running: boolean
  exitCode: number | null
  segments: RunSegment[]
  hint: string | null
}

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
      <LeoCodeLogo size={64} className="splash-logo" />
      <div className="splash-name">LeoCode</div>
      <div className="splash-note">Starting your mobile IDE…</div>
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

  const [settings, updateSettings] = useUserSettings()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Sync app interface theme when user changes it in settings
  useEffect(() => {
    if (settings.appTheme !== mode) {
      setMode(settings.appTheme)
    }
  }, [settings.appTheme, mode, setMode])

  const [view, setView] = useState<View>("editor")
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
    async (path = activePath): Promise<boolean> => {
      if (!path) return false
      const doc = docs.find((item) => item.path === path)
      if (!doc) return false
      try {
        await bridge.write(path, doc.content)
        setDocs((current) =>
          current.map((item) =>
            item.path === path ? { ...item, saved: item.content } : item
          )
        )
        flash("Saved")
        if (dirName(path) === cwd) void refresh()
        return true
      } catch (e) {
        setError((e as Error).message)
        return false
      }
    },
    [activePath, bridge, cwd, docs, flash, refresh]
  )

  const reloadFile = useCallback(
    async (path = activePath) => {
      if (!path) return
      const doc = docs.find((item) => item.path === path)
      if (!doc) return
      if (
        isDirty(doc) &&
        !window.confirm(`Discard unsaved changes to ${baseName(path)} and reload from disk?`)
      ) {
        return
      }
      try {
        const content = await bridge.read(path)
        setDocs((current) =>
          current.map((item) =>
            item.path === path ? { ...item, content, saved: content } : item
          )
        )
        flash("Reloaded from disk")
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [activePath, bridge, docs, flash]
  )


  // ----------------------------------------------------------------- run

  const [run, setRun] = useState<RunState | null>(null)
  const runHandle = useRef<RunHandle | null>(null)
  const runBuffer = useRef<RunSegment[]>([])
  const runFrame = useRef<number | null>(null)
  const runOpen = useRef(false)
  runOpen.current = run !== null

  const flushRunOutput = useCallback(() => {
    if (runFrame.current !== null) {
      window.cancelAnimationFrame(runFrame.current)
      runFrame.current = null
    }
    const pending = runBuffer.current
    if (pending.length === 0) return
    runBuffer.current = []
    setRun((current) => {
      if (!current) return current
      const segments = current.segments.slice()
      for (const segment of pending) {
        const last = segments[segments.length - 1]
        if (last && last.stream === segment.stream) {
          segments[segments.length - 1] = {
            stream: last.stream,
            text: last.text + segment.text
          }
        } else {
          segments.push({ stream: segment.stream, text: segment.text })
        }
      }
      let total = 0
      for (const segment of segments) total += segment.text.length
      while (total > RUN_LIMIT && segments.length > 0) {
        const first = segments[0]
        const overflow = total - RUN_LIMIT
        if (first.text.length <= overflow) {
          total -= first.text.length
          segments.shift()
        } else {
          segments[0] = { stream: first.stream, text: first.text.slice(overflow) }
          total = RUN_LIMIT
        }
      }
      return { ...current, segments }
    })
  }, [])

  const queueRunOutput = useCallback(
    (event: ProcessEvent) => {
      runBuffer.current.push({ stream: event.stream, text: event.data })
      if (runFrame.current !== null) return
      runFrame.current = window.requestAnimationFrame(() => {
        runFrame.current = null
        flushRunOutput()
      })
    },
    [flushRunOutput]
  )

  const finishRun = useCallback(
    (exitCode: number | null, hint: string | null) => {
      flushRunOutput()
      runHandle.current = null
      setRun((current) =>
        current ? { ...current, running: false, exitCode, hint: current.hint ?? hint } : current
      )
    },
    [flushRunOutput]
  )

  const pythonReady = useRef<boolean | null>(null)

  const stopRun = useCallback(() => {
    runHandle.current?.cancel()
  }, [])

  const closeRun = useCallback(() => {
    runHandle.current?.cancel()
    runHandle.current = null
    if (runFrame.current !== null) {
      window.cancelAnimationFrame(runFrame.current)
      runFrame.current = null
    }
    runBuffer.current = []
    setRun(null)
  }, [])

  const runFile = useCallback(async () => {
    const doc = activeDoc
    if (!doc) return
    const name = baseName(doc.path)
    const kind = runKind(name)
    if (!kind) {
      setError(
        `LeoCode can only run .py and .sh files right now. ${name} needs an interpreter that is not installed.`
      )
      return
    }
    // Never run stale bytes: persist the buffer first when it differs from disk.
    if (isDirty(doc) && !(await save(doc.path))) return

    // `python3` is either present or not; probe once per session so the sheet can
    // explain the missing runtime instead of showing a raw exec error.
    if (kind === "python" && pythonReady.current === null) {
      try {
        pythonReady.current = (await bridge.run(["python3", "--version"], ".", () => {})) === 0
      } catch {
        pythonReady.current = false
      }
    }
    if (kind === "python" && !pythonReady.current) {
      setRun({
        title: name,
        running: false,
        exitCode: null,
        segments: [],
        hint: PYTHON_HINT
      })
      return
    }

    runBuffer.current = []
    if (runFrame.current !== null) {
      window.cancelAnimationFrame(runFrame.current)
      runFrame.current = null
    }
    setRun({ title: name, running: true, exitCode: null, segments: [], hint: null })

    const argv = kind === "python" ? ["python3", name] : ["/system/bin/sh", name]
    try {
      const code = await bridge.run(argv, dirName(doc.path), queueRunOutput, (handle) => {
        runHandle.current = handle
      })
      finishRun(code, null)
    } catch (e) {
      const message = (e as Error).message
      finishRun(null, kind === "python" ? `${message}\n\n${PYTHON_HINT}` : message)
    }
  }, [activeDoc, bridge, finishRun, queueRunOutput, save])

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
      if (sidebarOpen) {
        setSidebarOpen(false)
        return true
      }
      if (runOpen.current) {
        closeRun()
        return true
      }
      if (prompt || settingsOpen) {
        setPrompt(null)
        setSettingsOpen(false)
        return true
      }
      if (view !== "editor") {
        setView("editor")
        return true
      }
      return false
    }
    return () => {
      delete window.__leocodeBack
    }
  }, [closeRun, prompt, settingsOpen, sidebarOpen, view])

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
          <button
            className="icon-btn sidebar-toggle-btn"
            onClick={() => setSidebarOpen((s) => !s)}
            aria-label="Toggle explorer sidebar"
            title="Explorer (Files)"
          >
            <MenuIcon size={20} />
          </button>
          <LeoCodeLogo size={24} className="brand-logo" />
          <span className="brand-name">LeoCode</span>
        </div>
        <div className="app-bar-actions">
          {activeDoc && (
            <button
              className="icon-btn run"
              onClick={() => void runFile()}
              disabled={run?.running}
              aria-label={`Run ${baseName(activeDoc.path)}`}
              title={run?.running ? "Running…" : "Run"}
            >
              <PlayIcon size={19} />
            </button>
          )}
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
          {activeDoc && (
            <button
              className="icon-btn"
              onClick={() => void reloadFile()}
              aria-label={`Reload ${baseName(activeDoc.path)} from disk`}
              title="Reload from disk"
            >
              <RefreshIcon size={19} />
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
              <button
                className="tab-add"
                onClick={() => setSidebarOpen(true)}
                title="Open file from explorer"
                aria-label="Open file"
              >
                +
              </button>
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
                  fontSize={settings.fontSize}
                  fontFamily={settings.fontFamily}
                  editorTheme={settings.editorTheme}
                  tabSize={settings.tabSize}
                  wordWrap={settings.wordWrap}
                  lineNumbers={settings.lineNumbers}
                  formatOnSave={settings.formatOnSave}
                  onChange={(content) =>
                    setDocs((current) =>
                      current.map((item) =>
                        item.path === activeDoc.path ? { ...item, content } : item
                      )
                    )
                  }
                  onSave={() => void save()}
                  onReload={() => void reloadFile()}
                  onNotification={(msg) => flash(msg)}
                />
              </Suspense>
            </div>
          ) : (
            <div className="empty editor-empty">
              <CodeIcon size={32} />
              <p>No file open</p>
              <button className="btn primary" onClick={() => setSidebarOpen(true)}>
                Open File Explorer
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
                fontSize={settings.terminalFontSize}
                fontFamily={settings.fontFamily}
              />
            </Suspense>
          </section>
        )}

        <section
          className={"view runtimes-view" + (view === "runtimes" ? " current" : "")}
          aria-hidden={view !== "runtimes"}
        >
          <Suspense fallback={<div className="empty">Loading runtimes…</div>}>
            <RuntimeManager
              bridge={bridge}
              info={info}
              onOpenTerminal={() => go("terminal")}
            />
          </Suspense>
        </section>
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
            { id: "files", label: "Explorer", Icon: FolderIcon },
            { id: "editor", label: "Editor", Icon: CodeIcon },
            { id: "terminal", label: "Terminal", Icon: TerminalIcon },
            { id: "runtimes", label: "Runtimes", Icon: CpuIcon }
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            className={
              "tabbar-item" +
              (id === "files"
                ? sidebarOpen
                  ? " active"
                  : ""
                : view === id
                  ? " active"
                  : "")
            }
            onClick={() => {
              if (id === "files") {
                setSidebarOpen((s) => !s)
              } else {
                go(id)
              }
            }}
            aria-current={view === id ? "page" : undefined}
          >
            <Icon size={20} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        cwd={cwd}
        entries={entries}
        loading={loading}
        docs={docs}
        activePath={activePath}
        onOpenDoc={(path) => void openFile(path)}
        onCloseDoc={closeDoc}
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

      <RunSheet
        open={run !== null}
        title={run?.title ?? ""}
        running={run?.running ?? false}
        exitCode={run?.exitCode ?? null}
        segments={run?.segments ?? []}
        hint={run?.hint}
        onStop={stopRun}
        onClose={closeRun}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        bridgeMode={bridge.mode}
        version={info?.version ?? "0.1.0"}
        onOpenRuntimes={() => go("runtimes")}
      />

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
