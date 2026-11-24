import { useEffect, useRef, useState } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { useStores } from "../../app/stores"
import { AppError, type Bridge, type PythonStatus, type TerminalHandle } from "../../bridge"
import type { StoreApi } from "zustand/vanilla"
import type { RootState } from "../root/rootStore"
import {
  clearSessionId,
  readSessionId,
  sanitizeTerminalTitle,
  writeSessionId
} from "./session"
import { getPythonReplSpec, launchReplSession, type PythonReplSpec } from "./repl"
import { retryRoot } from "../root/retryRoot"

export interface TerminalPaneProps {
  bridge: Bridge
  cwd: string
  active: boolean
  dark: boolean
  fontSize?: number
  fontFamily?: string
  /** A non-recoverable attach/lifecycle failure, for the shared error surfaces. */
  onError?: (error: unknown) => void
  /** Optional PythonStatus to configure REPL environment */
  pythonStatus?: PythonStatus | null
  /** Optional callback when REPL is launched */
  onLaunchRepl?: (spec: PythonReplSpec) => void
  /** Optional RootStore override */
  rootStore?: StoreApi<RootState>
}

function palette(dark: boolean) {
  return dark
    ? {
        background: "#0f1115",
        foreground: "#d7dae0",
        cursor: "#7aa2f7",
        selectionBackground: "#2c3550"
      }
    : {
        background: "#fbfbfd",
        foreground: "#1c2027",
        cursor: "#2563eb",
        selectionBackground: "#cfe1ff"
      }
}

/** Keys that would otherwise be hard to reach on a soft keyboard. */
const EXTRA_KEYS: Array<{ label: string; send: string }> = [
  { label: "Esc", send: "\x1b" },
  { label: "Tab", send: "\t" },
  { label: "^C", send: "\x03" },
  { label: "^D", send: "\x04" },
  { label: "^L", send: "\x0c" },
  { label: "^Z", send: "\x1a" },
  { label: "←", send: "\x1b[D" },
  { label: "↑", send: "\x1b[A" },
  { label: "↓", send: "\x1b[B" },
  { label: "→", send: "\x1b[C" },
  { label: "|", send: "|" },
  { label: "~", send: "~" },
  { label: "/", send: "/" },
  { label: "-", send: "-" },
  { label: "Home", send: "\x1b[H" },
  { label: "End", send: "\x1b[F" }
]

const NO_RUNTIME =
  "\r\n\x1b[33mLeoCode: the native PTY is unavailable here.\x1b[0m\r\n" +
  "Running the line-mode fallback: type a command and press Enter.\r\n"

const encoder = new TextEncoder()

function useOptionalStores() {
  try {
    return useStores()
  } catch {
    return null
  }
}

function useRootStoreState(stores: ReturnType<typeof useOptionalStores>) {
  const root = stores?.root
  const [state, setState] = useState(() => root?.getState() ?? null)
  useEffect(() => {
    if (!root) return
    setState(root.getState())
    return root.subscribe((next) => setState(next))
  }, [root])
  return state
}

export function TerminalPane({
  bridge,
  cwd,
  active,
  dark,
  fontSize = 13,
  fontFamily = "'JetBrains Mono', monospace",
  onError,
  pythonStatus,
  onLaunchRepl,
  rootStore: propRootStore
}: TerminalPaneProps) {
  const stores = useOptionalStores()
  const rootStore = propRootStore ?? stores?.root
  const rootStoreState = useRootStoreState(rootStore ? { root: rootStore } as any : stores)
  const host = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const handleRef = useRef<TerminalHandle | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const isRootProcessAlive = useRef(false)
  const [rootLostBanner, setRootLostBanner] = useState(false)
  const [status, setStatus] = useState<"starting" | "pty" | "fallback" | "closed">(
    "starting"
  )
  const [exited, setExited] = useState<number | null>(null)
  const [generation, setGeneration] = useState(0)
  const [isRootSession, setIsRootSession] = useState(false)
  /** OSC 0/2 title, sanitised; "workspace" until the shell sends one. */
  const [title, setTitle] = useState("")

  // Optimistic local echo in fallback mode
  const fallbackRunRef = useRef<(command: string) => Promise<void>>(async () => {})

  // -------------------------------------------------------- terminal instance
  useEffect(() => {
    if (!host.current) return

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: fontFamily || "ui-monospace, monospace",
      fontSize: fontSize || 13,
      lineHeight: 1.25,
      scrollback: 4000,
      allowProposedApi: true,
      theme: palette(dark)
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)
    termRef.current = term
    fitRef.current = fit

    // Titles are untrusted PTY output: sanitise them before rendering. OSC 52
    // would let a program write the device clipboard; swallow it (Task 13).
    const onTitle = (data: string) => {
      setTitle(sanitizeTerminalTitle(data))
      return true
    }
    const oscTitle = term.parser.registerOscHandler(0, onTitle)
    const oscTitle2 = term.parser.registerOscHandler(2, onTitle)
    const oscClipboard = term.parser.registerOscHandler(52, () => true)

    let disposed = false
    let polling: number | null = null

    const measure = () => {
      try {
        fit.fit()
      } catch {
        // The host can be 0x0 while the tab is hidden; ignore and refit later.
      }
      return { cols: Math.max(20, term.cols), rows: Math.max(5, term.rows) }
    }
    const size = measure()

    let line = ""
    const fallbackPrompt = () => term.write("\r\n\x1b[36m$\x1b[0m ")
    const fallbackRun = async (command: string) => {
      const trimmed = command.trim()
      if (!trimmed) return fallbackPrompt()
      if (trimmed === "clear") {
        term.clear()
        term.write("\x1b[H")
        return fallbackPrompt()
      }
      const argv = trimmed.split(/\s+/)
      try {
        await bridge.run(argv, cwd, (event) => {
          term.write(
            event.data.replace(/\n/g, "\r\n").replace(/\r\r\n/g, "\r\n")
          )
        })
      } catch (error) {
        term.write(`\r\n${(error as Error).message}\r\n`)
      }
      fallbackPrompt()
    }
    fallbackRunRef.current = fallbackRun

    void (async () => {
      const onExit = (code: number) => {
        if (disposed) return
        term.write(`\r\n\x1b[90m[session ended, exit ${code}]\x1b[0m\r\n`)
        handleRef.current = null
        currentSessionIdRef.current = null
        if (isRootProcessAlive.current) {
          isRootProcessAlive.current = false
          rootStore?.getState().rootProcessEnded()
        }
        clearSessionId()
        setExited(code)
        setStatus("closed")
      }

      const tryAttach = async (): Promise<boolean> => {
        const saved = readSessionId()
        if (!saved || !bridge.attachTerminal) return false
        try {
          const attached = await bridge.attachTerminal(saved, {
            onData: (bytes, done) => term.write(bytes, done),
            onExit
          })
          if (disposed) {
            attached?.handle.detach()
            return true
          }
          if (!attached) {
            clearSessionId()
            return false
          }
          if (!attached.alive) {
            attached.handle.detach()
            handleRef.current = null
            currentSessionIdRef.current = null
            clearSessionId()
            setExited(attached.exitCode)
            setStatus("closed")
            return true
          }
          handleRef.current = attached.handle
          currentSessionIdRef.current = attached.handle.sessionId
          if (isRootSession) {
            isRootProcessAlive.current = true
            rootStore?.getState().rootProcessStarted()
          }
          setStatus("pty")
          attached.handle.resize(size.cols, size.rows)
          term.onData((data) => attached.handle.write(encoder.encode(data)))
          term.focus()
          return true
        } catch (error) {
          if (error instanceof AppError && error.code === "E_NOT_FOUND") return false
          onError?.(error)
          setExited(null)
          setStatus("closed")
          return true
        }
      }

      const startPty = async () => {
        const handle = await bridge.openTerminal({
          cwd,
          cols: size.cols,
          rows: size.rows,
          root: isRootSession,
          onData: (bytes, done) => term.write(bytes, done),
          onExit
        })
        if (disposed) {
          handle?.detach()
          return
        }
        if (handle) {
          handleRef.current = handle
          currentSessionIdRef.current = handle.sessionId
          writeSessionId(handle.sessionId)
          if (!handle.alive) return
          if (isRootSession) {
            isRootProcessAlive.current = true
            rootStore?.getState().rootProcessStarted()
          }
          setStatus("pty")
          term.onData((data) => handle.write(encoder.encode(data)))
          term.write("\x1b[2J\x1b[H")
          term.focus()
        } else {
          setStatus("fallback")
          term.write(NO_RUNTIME)
          fallbackPrompt()
          term.onData((data) => {
            for (const char of data) {
              if (char === "\r") {
                term.write("\r\n")
                void fallbackRun(line)
                line = ""
              } else if (char === "\x7f") {
                if (line.length > 0) {
                  line = line.slice(0, -1)
                  term.write("\b \b")
                }
              } else if (char === "\x03") {
                line = ""
                term.write("^C")
                fallbackPrompt()
              } else if (char >= " ") {
                line += char
                term.write(char)
              }
            }
          })
        }
      }

      try {
        if (!(await tryAttach())) await startPty()
      } catch (error) {
        if (disposed) return
        onError?.(error)
        setStatus("fallback")
        term.write(`\r\n\x1b[31m${(error as Error).message}\x1b[0m\r\n`)
        fallbackPrompt()
      }
    })()

    const onResize = () => {
      const next = measure()
      handleRef.current?.resize(next.cols, next.rows)
    }
    const observer = new ResizeObserver(() => {
      if (polling !== null) window.cancelAnimationFrame(polling)
      polling = window.requestAnimationFrame(onResize)
    })
    observer.observe(host.current)

    return () => {
      disposed = true
      observer.disconnect()
      if (polling !== null) window.cancelAnimationFrame(polling)
      if (isRootProcessAlive.current) {
        isRootProcessAlive.current = false
        rootStore?.getState().rootProcessEnded()
      }
      currentSessionIdRef.current = null
      handleRef.current?.detach()
      handleRef.current = null
      oscTitle.dispose()
      oscTitle2.dispose()
      oscClipboard.dispose()
      term.dispose()
      termRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, generation])

  // -------------------------------------------------------------- theme sync
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = palette(dark)
  }, [dark])

  useEffect(() => {
    const term = termRef.current
    if (term) {
      if (fontSize) term.options.fontSize = fontSize
      if (fontFamily) term.options.fontFamily = fontFamily
      try {
        fitRef.current?.fit()
      } catch {
        /* ignore */
      }
    }
  }, [fontSize, fontFamily])

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => {
      try {
        fitRef.current?.fit()
      } catch {
        /* ignore */
      }
      const term = termRef.current
      if (term && handleRef.current) {
        handleRef.current.resize(Math.max(20, term.cols), Math.max(5, term.rows))
        term.focus()
      }
    }, 60)
    return () => window.clearTimeout(timer)
  }, [active])

  useEffect(() => {
    const unsub = bridge.onRootLost?.((event) => {
      if (event.sessionId && event.sessionId === currentSessionIdRef.current) {
        if (isRootProcessAlive.current) {
          isRootProcessAlive.current = false
          rootStore?.getState().rootProcessEnded()
        }
        currentSessionIdRef.current = null
        handleRef.current?.close()
        handleRef.current = null
        clearSessionId()
        setExited(-1)
        setStatus("closed")
        setRootLostBanner(true)
      }
    })
    return () => unsub?.()
  }, [bridge, rootStore])

  const send = (text: string) => {
    const handle = handleRef.current
    if (handle) {
      handle.write(encoder.encode(text))
    } else {
      const term = termRef.current
      term?.focus()
    }
  }

  const handleLaunchRepl = async () => {
    let resolved = pythonStatus
    if (resolved === undefined && bridge.pythonStatus) {
      try {
        resolved = await bridge.pythonStatus({})
      } catch {
        resolved = null
      }
    }
    const spec = getPythonReplSpec(resolved)
    onLaunchRepl?.(spec)

    const handle = handleRef.current
    if (handle) {
      launchReplSession(handle, spec)
      termRef.current?.focus()
    } else if (status === "fallback") {
      void fallbackRunRef.current(spec.commandString.trim())
    } else if (status === "closed") {
      setExited(null)
      setStatus("starting")
      setGeneration((value) => value + 1)
    }
  }

  return (
    <div className="terminal">
      <div className="terminal-chrome">
        <span className={"term-status " + status}>
          {status === "pty"
            ? "pty"
            : status === "fallback"
              ? "line mode"
              : status === "closed"
                ? `exited${exited === null ? "" : " " + exited}`
                : "starting"}
        </span>
        {isRootSession && status !== "closed" && (
          <span
            className="badge root-badge"
            title="Terminal running as superuser (root / UID 0)"
            style={{
              fontSize: 10,
              fontWeight: 700,
              background: "var(--color-danger, #ef4444)",
              color: "#ffffff",
              padding: "2px 5px",
              borderRadius: 3,
              letterSpacing: 0.5
            }}
          >
            # ROOT
          </span>
        )}
        <span className="terminal-cwd" title={title || undefined}>
          {title || (cwd === "." ? "workspace" : cwd)}
        </span>
        {rootStoreState?.enabled && (
          <button
            className={"btn tiny " + (isRootSession ? "danger" : "")}
            style={isRootSession ? { background: "var(--color-danger, #ef4444)", color: "#fff", border: "none" } : undefined}
            title={isRootSession ? "Switch to standard user terminal" : "Launch root terminal session (UID 0)"}
            onClick={() => {
              if (isRootProcessAlive.current) {
                isRootProcessAlive.current = false
                rootStore?.getState().rootProcessEnded()
              }
              currentSessionIdRef.current = null
              handleRef.current?.close()
              clearSessionId()
              setIsRootSession((prev) => !prev)
              setStatus("starting")
              setExited(null)
              setGeneration((v) => v + 1)
            }}
          >
            {isRootSession ? "Exit Root Shell" : "Root Shell"}
          </button>
        )}
        <button
          className="btn tiny btn-repl"
          title="Open interactive Python REPL in this environment"
          onClick={() => void handleLaunchRepl()}
          aria-label="Python REPL"
        >
          Python REPL
        </button>
        {status === "closed" ? (
          <button
            className="btn tiny"
            onClick={() => {
              setExited(null)
              setStatus("starting")
              setGeneration((value) => value + 1)
            }}
          >
            Restart
          </button>
        ) : (
          <button
            className="btn tiny"
            onClick={() => {
              termRef.current?.reset()
              termRef.current?.focus()
            }}
          >
            Clear
          </button>
        )}
      </div>

      {rootLostBanner && (
        <div
          className="terminal-lost-banner"
          role="alert"
          style={{
            padding: "8px 12px",
            background: "var(--color-danger-subtle, rgba(239, 68, 68, 0.15))",
            borderBottom: "1px solid var(--color-danger, #ef4444)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            fontSize: 12
          }}
        >
          <span>Root access was refused. The root session ended.</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn tiny primary"
              onClick={async () => {
                const root = rootStore ?? stores?.root
                const errors = stores?.errors
                if (!root || !errors) return
                const ok = await retryRoot({ root, errors })
                if (ok) {
                  setRootLostBanner(false)
                  setExited(null)
                  setStatus("starting")
                  setGeneration((v) => v + 1)
                }
              }}
            >
              Try again
            </button>
            <button
              className="btn tiny"
              onClick={() => {
                setRootLostBanner(false)
                setIsRootSession(false)
                setExited(null)
                setStatus("starting")
                setGeneration((v) => v + 1)
              }}
            >
              Open normal shell
            </button>
          </div>
        </div>
      )}

      <div className="terminal-host" ref={host} />

      <div className="key-row terminal-keys" role="toolbar" aria-label="Terminal keys">
        {EXTRA_KEYS.map((key) => (
          <button
            key={key.label}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => send(key.send)}
          >
            {key.label}
          </button>
        ))}
      </div>
    </div>
  )
}
