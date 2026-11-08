import { useEffect, useRef, useState } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import type { Bridge, TerminalHandle } from "../bridge"

interface Props {
  bridge: Bridge
  cwd: string
  active: boolean
  dark: boolean
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

export function TerminalPane({ bridge, cwd, active, dark }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const handleRef = useRef<TerminalHandle | null>(null)
  const [status, setStatus] = useState<"starting" | "pty" | "fallback" | "closed">(
    "starting"
  )
  const [exited, setExited] = useState<number | null>(null)
  const [generation, setGeneration] = useState(0)

  // -------------------------------------------------------- terminal instance
  useEffect(() => {
    if (!host.current) return

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 12.5,
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

    // Optimistic local echo in fallback mode, so typing feels immediate even
    // before a command finishes.
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

    void (async () => {
      try {
        const handle = await bridge.openTerminal({
          cwd,
          cols: size.cols,
          rows: size.rows,
          onData: (bytes) => term.write(bytes),
          onExit: (code) => {
            if (disposed) return
            term.write(`\r\n\x1b[90m[session ended, exit ${code}]\x1b[0m\r\n`)
            handleRef.current = null
            setExited(code)
            setStatus("closed")
          }
        })
        if (disposed) {
          handle?.close()
          return
        }
        if (handle) {
          handleRef.current = handle
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
      } catch (error) {
        if (disposed) return
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
      // Coalesce bursts of layout events into one frame.
      if (polling !== null) window.cancelAnimationFrame(polling)
      polling = window.requestAnimationFrame(onResize)
    })
    observer.observe(host.current)

    return () => {
      disposed = true
      observer.disconnect()
      if (polling !== null) window.cancelAnimationFrame(polling)
      handleRef.current?.close()
      handleRef.current = null
      term.dispose()
      termRef.current = null
    }
    // One PTY per mount or restart. cwd/theme changes are applied in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge, generation])

  // -------------------------------------------------------------- theme sync
  useEffect(() => {
    const term = termRef.current
    if (term) term.options.theme = palette(dark)
  }, [dark])

  // Hidden tabs have no layout; refit and focus when the tab becomes visible.
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

  const send = (text: string) => {
    const handle = handleRef.current
    if (handle) {
      handle.write(encoder.encode(text))
    } else {
      const term = termRef.current
      term?.focus()
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
        <span className="terminal-cwd">{cwd === "." ? "workspace" : cwd}</span>
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
