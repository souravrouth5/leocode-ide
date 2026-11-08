import { useEffect, useRef } from "react"
import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import type { Bridge } from "../bridge"

interface Props {
  bridge: Bridge
  cwd: string
  onCwdChange: (cwd: string) => void
}

const PROMPT = "\x1b[38;5;75mleocode\x1b[0m:\x1b[38;5;214m~\x1b[0m$ "

export function TerminalPane({ bridge, cwd, onCwdChange }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  useEffect(() => {
    if (!host.current) return

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
      fontSize: 12,
      scrollback: 5000,
      theme: {
        background: "#0d1017",
        foreground: "#d7dae0",
        cursor: "#7aa2f7",
        selectionBackground: "#2c3550"
      }
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current)

    const refit = () => {
      try {
        fit.fit()
      } catch {
        /* container not laid out yet */
      }
    }
    refit()
    const observer = new ResizeObserver(refit)
    observer.observe(host.current)

    term.writeln("\x1b[1mLeoCode terminal\x1b[0m \x1b[38;5;245m(bridge: " + bridge.mode + ")\x1b[0m")
    term.writeln("Type \x1b[1mhelp\x1b[0m for commands.\r\n")
    term.write(PROMPT)

    let line = ""
    let running = false

    const prompt = () => term.write(PROMPT)

    const execute = async (raw: string) => {
      const trimmed = raw.trim()
      if (!trimmed) {
        prompt()
        return
      }

      const argv = trimmed.split(/\s+/)

      if (argv[0] === "clear") {
        term.clear()
        prompt()
        return
      }

      if (argv[0] === "help") {
        term.writeln("ls [dir]   list files        cat <file>   print a file")
        term.writeln("pwd        working dir       cd <dir>     change dir")
        term.writeln("python     run interpreter   git status   repository state")
        term.writeln("clear      clear screen      help         this text")
        prompt()
        return
      }

      if (argv[0] === "cd") {
        const target = argv[1] ?? "."
        if (target === "..") {
          const parts = cwdRef.current.split("/")
          parts.pop()
          onCwdChange(parts.length ? parts.join("/") : ".")
        } else if (target === "/" || target === "~" || target === ".") {
          onCwdChange(".")
        } else {
          const next = cwdRef.current === "." ? target : `${cwdRef.current}/${target}`
          try {
            await bridge.list(next)
            onCwdChange(next)
          } catch {
            term.writeln(`\x1b[31mcd: no such directory: ${target}\x1b[0m`)
          }
        }
        prompt()
        return
      }

      running = true
      try {
        const code = await bridge.run(argv, cwdRef.current, (event) => {
          if (event.stream === "stderr") {
            term.write("\x1b[31m" + event.data.replace(/\n/g, "\x1b[0m\r\n") + "\x1b[0m")
          } else {
            term.write(event.data.replace(/\n/g, "\r\n"))
          }
        })
        if (code !== 0) term.writeln(`\x1b[38;5;245m[exit ${code}]\x1b[0m`)
      } catch (error) {
        term.writeln(`\x1b[31m${(error as Error).message}\x1b[0m`)
      } finally {
        running = false
        prompt()
      }
    }

    const disposable = term.onData((data) => {
      if (running) return

      if (data === "\r") {
        term.write("\r\n")
        const submitted = line
        line = ""
        void execute(submitted)
        return
      }

      if (data === "\u007f") {
        if (line.length > 0) {
          line = line.slice(0, -1)
          term.write("\b \b")
        }
        return
      }

      if (data === "\u0003") {
        term.write("^C\r\n")
        line = ""
        prompt()
        return
      }

      // Ignore escape sequences and control characters other than tab.
      if (data === "\t") {
        line += "  "
        term.write("  ")
        return
      }
      if (data.length === 1 && data.charCodeAt(0) < 32) return

      line += data
      term.write(data)
    })

    return () => {
      disposable.dispose()
      observer.disconnect()
      term.dispose()
    }
  }, [bridge, onCwdChange])

  return <div className="terminal-host" ref={host} />
}
