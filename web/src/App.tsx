import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react"
import { useStore } from "zustand"
import { createBridge, type AppInfo, type Bridge, type FileEntry, type ProcessEvent, type RunHandle, type StorageInfo, type ThemeState } from "./bridge"
import { StoresProvider, createAppStores, useStores, type AppStores } from "./app/stores"
import { ErrorBoundary } from "./errors/ErrorBoundary"
import { CrashScreen, PaneError } from "./errors/CrashScreen"
import { ErrorSurfaces } from "./errors/ErrorSurfaces"
import { installGlobalErrorHandlers } from "./errors/globalHandlers"
import { lazyWithRetry } from "./errors/lazyWithRetry"
import { simulatedError } from "./errors/simulate"
import { EditMenu, FileMenu, OverflowMenu } from "./components/EditorMenus"
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

import { SettingsDialog } from "./components/SettingsDialog"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { useUserSettings } from "./settings/userSettings"
import { ThemeProvider, useTheme } from "./theme/ThemeProvider"

// CodeMirror, xterm, and runtime manager are code-split; a stale chunk after an
// app update triggers one reload instead of a blank pane (Task 12).
const EditorPane = lazyWithRetry(() =>
  import("./components/EditorPane").then((module) => ({ default: module.EditorPane }))
)
const TerminalPane = lazyWithRetry(() =>
  import("./components/TerminalPane").then((module) => ({ default: module.TerminalPane }))
)
const RuntimeManager = lazyWithRetry(() =>
  import("./components/RuntimeManager").then((module) => ({ default: module.RuntimeManager }))
)

type View = "files" | "editor" | "terminal" | "runtimes"

interface OpenDoc {
  path: string
  content: string
  /** Content when last loaded or saved; null for new unsaved files. */
  saved: string | null
  isUntitled?: boolean
}

const normalizeText = (text: string) => text.replace(/\r\n/g, "\n")

const isDirty = (doc: OpenDoc): boolean => {
  if (doc.saved === null) return true
  return normalizeText(doc.content) !== normalizeText(doc.saved)
}

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

  const stores = useMemo(() => createAppStores(), [])

  useEffect(
    () =>
      installGlobalErrorHandlers((error, context) => {
        stores.errors.getState().report(error, { context })
      }),
    [stores]
  )

  return (
    <StoresProvider stores={stores}>
      <ErrorBoundary
        fallback={(error) => (
          <CrashScreen
            error={error}
            onReload={() => location.reload()}
            onNotice={(message) =>
              stores.notifications.getState().enqueue({
                kind: "success",
                message,
                durationMs: 3_000
              })
            }
          />
        )}
      >
        <Boot stores={stores} />
      </ErrorBoundary>
    </StoresProvider>
  )
}

function Boot({ stores }: { stores: AppStores }) {
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
      } catch (error) {
        // createBridge's handshake succeeded, but the fuller info call failed.
        stores.errors.getState().report(error, { context: "Read app info" })
      }
      if (!cancelled) setReady({ bridge: result.bridge, info })
    })()
    return () => {
      cancelled = true
    }
  }, [stores])

  // `?simulate=<code>` demonstrates each error surface without breaking a real
  // operation. Mock mode only: the Android asset URL has no query string.
  useLayoutEffect(() => {
    if (!ready || "error" in ready || ready.bridge.mode !== "mock") return
    const simulated = simulatedError()
    if (simulated) stores.errors.getState().report(simulated, { context: "simulated" })
  }, [ready, stores])

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
  const { errors, notifications } = useStores()

  const report = useCallback(
    (error: unknown, context?: string, retry?: () => void) => {
      errors.getState().report(error, { context, retry })
    },
    [errors]
  )

  const statusError = useStore(
    errors,
    (state) => state.banner?.error.message ?? state.sheet?.error.message ?? null
  )

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
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)

  useEffect(() => {
    if (bridge.getStorageInfo) {
      void bridge.getStorageInfo().then(setStorageInfo).catch(() => {})
    }
  }, [bridge])

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
      } catch (e) {
        report(e, "Refresh file list")
      } finally {
        setLoading(false)
      }
    },
    [bridge, report]
  )

  useEffect(() => {
    void refresh(cwd)
  }, [cwd, refresh])

  const untitledCounter = useRef(1)
  const sessionLoaded = useRef(false)
  const sessionSaveWarned = useRef(false)

  const handleNewUntitled = useCallback(() => {
    const name = `Untitled-${untitledCounter.current++}`
    const newDoc: OpenDoc = {
      path: name,
      content: "",
      saved: null,
      isUntitled: true
    }
    setDocs((current) => [...current, newDoc])
    setActivePath(name)
    setView("editor")
  }, [])

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
        const rawContent = await bridge.read(path)
        const content = normalizeText(rawContent)
        setDocs((current) => [...current, { path, content, saved: content, isUntitled: false }])
        setActivePath(path)
        setView("editor")
        // Update recent files
        const recents = [path, ...(settings.recentFiles || []).filter((p) => p !== path)].slice(0, 20)
        updateSettings({ recentFiles: recents })
      } catch (e) {
        report(e, "Open file")
      }
    },
    [bridge, docs, settings.recentFiles, updateSettings, report]
  )

  const handleOpenSaf = useCallback(async () => {
    if (!bridge.openSafDocument) return
    try {
      const doc = await bridge.openSafDocument()
      if (!doc) {
        notifications.getState().enqueue({
          kind: "info",
          message: "No document selected",
          durationMs: 3_000
        })
        return
      }
      const safPath = `saf://${doc.name}`
      setDocs((current) => {
        const exists = current.find((d) => d.path === safPath)
        if (exists) return current
        const content = normalizeText(doc.content)
        return [...current, { path: safPath, content, saved: content, isUntitled: false }]
      })
      setActivePath(safPath)
      setView("editor")
      flash(`Opened ${doc.name}`)
    } catch (e) {
      report(e, "Open document")
    }
  }, [bridge, flash, report, notifications])

  const handleSaveAs = useCallback(() => {
    if (!activeDoc) return
    const initialName = activeDoc.isUntitled
      ? `${activeDoc.path}.txt`
      : activeDoc.path.startsWith("saf://")
        ? activeDoc.path.slice(6)
        : activeDoc.path
    setPrompt({
      title: "Save As",
      label: "Save file as (filename or full path):",
      initial: initialName,
      kind: "file"
    })
  }, [activeDoc])

  const closeAllDocs = useCallback(() => {
    if (docs.some(isDirty)) {
      if (!window.confirm("You have unsaved changes. Discard and close all tabs?")) return
    }
    setDocs([])
    setActivePath(null)
  }, [docs])

  const handleAddBookmark = useCallback(
    (path: string) => {
      const current = settings.bookmarks || []
      if (!current.includes(path)) {
        updateSettings({ bookmarks: [...current, path] })
        flash("Bookmark added")
      }
    },
    [settings.bookmarks, updateSettings, flash]
  )

  const handleRemoveBookmark = useCallback(
    (path: string) => {
      const current = settings.bookmarks || []
      updateSettings({ bookmarks: current.filter((b) => b !== path) })
      flash("Bookmark removed")
    },
    [settings.bookmarks, updateSettings, flash]
  )

  // Session restoration
  const SESSION_KEY = "leocode.open-session"

  useEffect(() => {
    if (!settings.resumeSession) {
      sessionLoaded.current = true
      return
    }
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) {
        sessionLoaded.current = true
        return
      }
      const session = JSON.parse(raw) as { paths: string[]; active: string | null }
      if (session.paths && session.paths.length > 0) {
        let missing = 0
        void Promise.all(
          session.paths.map(async (p): Promise<OpenDoc | null> => {
            try {
              const rawContent = await bridge.read(p)
              const content = normalizeText(rawContent)
              return { path: p, content, saved: content, isUntitled: false }
            } catch {
              // The file may have been deleted or moved since last session.
              missing += 1
              return null
            }
          })
        ).then((loaded) => {
          const valid = loaded.filter((d): d is OpenDoc => d !== null)
          if (missing > 0) {
            notifications.getState().enqueue({
              kind: "warning",
              message: `${missing} restored tab${missing === 1 ? "" : "s"} could not be opened`,
              durationMs: 5_000
            })
          }
          if (valid.length > 0) {
            setDocs(valid)
            setActivePath(
              session.active && valid.some((d) => d.path === session.active)
                ? session.active
                : valid[0].path
            )
          }
          sessionLoaded.current = true
        })
      } else {
        sessionLoaded.current = true
      }
    } catch (error) {
      sessionLoaded.current = true
      report(error, "Restore the previous session")
    }
  }, [bridge, settings.resumeSession, notifications, report])

  useEffect(() => {
    if (!sessionLoaded.current || !settings.resumeSession) return
    try {
      const validPaths = docs
        .filter((d) => !d.isUntitled && !d.path.startsWith("saf://"))
        .map((d) => d.path)
      const session = {
        paths: validPaths,
        active: activeDoc?.isUntitled ? null : activePath
      }
      localStorage.setItem(SESSION_KEY, JSON.stringify(session))
    } catch {
      // Storage can be full or blocked. Warn once, not on every keystroke.
      if (!sessionSaveWarned.current) {
        sessionSaveWarned.current = true
        notifications.getState().enqueue({
          kind: "warning",
          message: "Session state could not be saved",
          durationMs: 5_000
        })
      }
    }
  }, [docs, activePath, activeDoc, settings.resumeSession, notifications])

  const save = useCallback(
    async (path = activePath): Promise<boolean> => {
      if (!path) return false
      const doc = docs.find((item) => item.path === path)
      if (!doc) return false
      if (doc.isUntitled || doc.saved === null) {
        handleSaveAs()
        return false
      }
      try {
        await bridge.write(path, doc.content)
        setDocs((current) =>
          current.map((item) =>
            item.path === path ? { ...item, saved: item.content, isUntitled: false } : item
          )
        )
        flash("Saved")
        if (dirName(path) === cwd) void refresh()
        return true
      } catch (e) {
        report(e, "Save file")
        return false
      }
    },
    [activeDoc, activePath, bridge, cwd, docs, flash, handleSaveAs, refresh, report]
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
        report(e, "Reload file")
      }
    },
    [activePath, bridge, docs, flash, report]
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
      notifications.getState().enqueue({
        kind: "warning",
        message: `LeoCode can only run .py and .sh files right now`,
        detail: `${name} needs an interpreter that is not installed`,
        durationMs: 6_000
      })
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
      // The run sheet is the error surface here; it shows the message and hint.
      const message = (e as Error).message
      finishRun(null, kind === "python" ? `${message}\n\n${PYTHON_HINT}` : message)
    }
  }, [activeDoc, bridge, finishRun, queueRunOutput, save, notifications])

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
        if (prompt.title === "Save As" && activeDoc) {
          const target = value.startsWith("/") ? value : join(cwd, value)
          await bridge.write(target, activeDoc.content)
          setDocs((current) =>
            current.map((item) =>
              item.path === activeDoc.path
                ? { ...item, path: target, saved: activeDoc.content, isUntitled: false }
                : item
            )
          )
          setActivePath(target)
          flash(`Saved as ${baseName(target)}`)
          await refresh()
          return
        } else if (prompt.kind === "rename" && prompt.target) {
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
          const path = value.startsWith("/") ? value : join(cwd, value)
          await bridge.write(path, "")
          flash("File created")
          await refresh()
          await openFile(path)
          return
        }
        await refresh()
      } catch (e) {
        report(e, prompt.kind === "rename" ? "Rename" : "Create file or folder")
      }
    },
    [activeDoc, bridge, cwd, flash, openFile, prompt, refresh, report]
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
        report(e, "Delete")
      }
    },
    [bridge, flash, refresh, report]
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
  const notify = useCallback(
    (text: string) =>
      notifications.getState().enqueue({ kind: "success", message: text, durationMs: 3_000 }),
    [notifications]
  )

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
          <FileMenu
            onNew={handleNewUntitled}
            onOpenExplorer={() => setSidebarOpen(true)}
            onOpenSaf={handleOpenSaf}
            onSave={() => void save()}
            onSaveAs={handleSaveAs}
            onReload={() => void reloadFile()}
            onCloseTab={() => activePath && closeDoc(activePath)}
            onCloseAllTabs={closeAllDocs}
            hasActiveDoc={activeDoc !== null}
            isDirty={activeDirty}
          />

          <EditMenu
            onUndo={() =>
              window.dispatchEvent(
                new CustomEvent("leocode:editor-command", { detail: { action: "undo" } })
              )
            }
            onRedo={() =>
              window.dispatchEvent(
                new CustomEvent("leocode:editor-command", { detail: { action: "redo" } })
              )
            }
            onSelectAll={() =>
              window.dispatchEvent(
                new CustomEvent("leocode:editor-command", { detail: { action: "selectAll" } })
              )
            }
            onFormat={() =>
              window.dispatchEvent(
                new CustomEvent("leocode:editor-command", { detail: { action: "format" } })
              )
            }
            onInsertDateTime={() =>
              window.dispatchEvent(
                new CustomEvent("leocode:editor-command", {
                  detail: { action: "insert", value: new Date().toLocaleString() }
                })
              )
            }
            onIndent={() =>
              window.dispatchEvent(
                new CustomEvent("leocode:editor-command", { detail: { action: "indent" } })
              )
            }
            onUnindent={() =>
              window.dispatchEvent(
                new CustomEvent("leocode:editor-command", { detail: { action: "unindent" } })
              )
            }
            hasActiveDoc={activeDoc !== null}
          />

          {activeDoc && (
            <button
              className="icon-btn run"
              onClick={() => void runFile()}
              disabled={run?.running}
              aria-label={`Run ${baseName(activeDoc.path)}`}
              title={run?.running ? "Running…" : "Run"}
            >
              <PlayIcon size={15} />
            </button>
          )}

          <OverflowMenu
            onSearch={() =>
              window.dispatchEvent(
                new CustomEvent("leocode:editor-command", { detail: { action: "search" } })
              )
            }
            onGotoLine={() => {
              const line = window.prompt("Goto line number:")
              if (line) {
                window.dispatchEvent(
                  new CustomEvent("leocode:editor-command", {
                    detail: { action: "gotoLine", value: line }
                  })
                )
              }
            }}
            onSelectSyntax={() => setSettingsOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
            wordWrap={settings.wordWrap}
            onToggleWordWrap={() => updateSettings({ wordWrap: !settings.wordWrap })}
            lineNumbers={settings.lineNumbers}
            onToggleLineNumbers={() => updateSettings({ lineNumbers: !settings.lineNumbers })}
            onShowStatistics={() => {
              if (!activeDoc) return
              const lines = activeDoc.content.split("\n").length
              const words = activeDoc.content.trim()
                ? activeDoc.content.trim().split(/\s+/).length
                : 0
              const chars = activeDoc.content.length
              flash(
                `${lines} lines, ${words} words, ${chars} chars (${(chars / 1024).toFixed(1)} KB)`
              )
            }}
          />
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
                onClick={handleNewUntitled}
                title="New file"
                aria-label="New file"
              >
                +
              </button>
            </div>
          )}

          {activeDoc ? (
            <div className="editor-body">
              <ErrorBoundary
                resetKey={activeDoc.path}
                fallback={(error, reset) => (
                  <PaneError error={error} onRetry={reset} onNotice={notify} />
                )}
              >
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
              </ErrorBoundary>
            </div>
          ) : (
            <div className="empty editor-empty">
              <CodeIcon size={32} />
              <p>No file open</p>
              <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
                <button className="btn primary" onClick={() => setSidebarOpen(true)}>
                  Open File Explorer
                </button>
                <button className="btn ghost" onClick={handleNewUntitled}>
                  + New File
                </button>
              </div>
            </div>
          )}
        </section>

        {terminalMounted && (
          <section
            className={"view terminal-view" + (view === "terminal" ? " current" : "")}
            aria-hidden={view !== "terminal"}
          >
            <ErrorBoundary
              fallback={(error, reset) => (
                <PaneError
                  error={error}
                  onRetry={reset}
                  onNotice={notify}
                  title="The terminal crashed"
                />
              )}
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
            </ErrorBoundary>
          </section>
        )}

        <section
          className={"view runtimes-view" + (view === "runtimes" ? " current" : "")}
          aria-hidden={view !== "runtimes"}
        >
          <ErrorBoundary
            fallback={(error, reset) => (
              <PaneError
                error={error}
                onRetry={reset}
                onNotice={notify}
                title="The runtime list crashed"
              />
            )}
          >
            <Suspense fallback={<div className="empty">Loading runtimes…</div>}>
              <RuntimeManager
                bridge={bridge}
                info={info}
                onOpenTerminal={() => go("terminal")}
              />
            </Suspense>
          </ErrorBoundary>
        </section>
      </main>

      <StatusBar
        mode={bridge.mode}
        path={statusError ? "error" : statusPath}
        dirty={activeDirty}
        message={statusError ?? message}
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
        storageInfo={storageInfo}
        bookmarks={settings.bookmarks || []}
        recentFiles={settings.recentFiles || []}
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
        onOpenSaf={handleOpenSaf}
        onAddBookmark={handleAddBookmark}
        onRemoveBookmark={handleRemoveBookmark}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTerminal={() => {
          setView("terminal")
          setTerminalMounted(true)
        }}
        onOpenRuntimes={() => setView("runtimes")}
        version={info?.version ?? "0.1.0"}
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

      <ErrorSurfaces errors={errors} notifications={notifications} />
    </div>
  )
}
