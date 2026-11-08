import {
  BridgeError,
  type AppInfo,
  type Bridge,
  type FileEntry,
  type ProcessEvent,
  type RunHandle,
  type SafDocument,
  type StorageInfo,
  type TerminalHandle,
  type TerminalOptions,
  type ThemeMode,
  type ThemeState
} from "./types"

/** The object injected by WebViewCompat.addWebMessageListener. */
export interface InjectedChannel {
  postMessage: (data: string) => void
  onmessage: ((event: { data: string }) => void) | null
}

interface Reply {
  v: number
  id: string | null
  ok?: boolean
  payload?: unknown
  error?: { code?: string; message?: string }
  event?: string
}

type StreamHandler = (event: string, payload: any) => void

export class AndroidBridge implements Bridge {
  readonly mode = "android" as const

  private seq = 0
  private readonly pending = new Map<
    string,
    { resolve: (value: any) => void; reject: (reason: unknown) => void }
  >()
  private readonly streams = new Map<string, StreamHandler>()
  private readonly themeListeners = new Set<(state: ThemeState) => void>()

  constructor(private readonly channel: InjectedChannel) {
    channel.onmessage = (event) => this.receive(event.data)
    ;(window as any).__leocodeThemeEvent = (state: ThemeState) => {
      this.themeListeners.forEach((listener) => listener(state))
    }
  }

  // ------------------------------------------------------------- transport

  private send<T>(method: string, payload: unknown, onEvent?: StreamHandler): {
    id: string
    result: Promise<T>
  } {
    const id = String(++this.seq)
    if (onEvent) this.streams.set(id, onEvent)

    const result = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.channel.postMessage(JSON.stringify({ v: 1, id, method, payload }))
      } catch (error) {
        this.pending.delete(id)
        this.streams.delete(id)
        reject(error)
      }
    })

    return { id, result }
  }

  private receive(raw: string) {
    let message: Reply
    try {
      message = JSON.parse(raw) as Reply
    } catch {
      return
    }

    if (message.event) {
      if (message.id) this.streams.get(message.id)?.(message.event, message.payload)
      return
    }

    if (!message.id) return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)

    if (message.ok) {
      pending.resolve(message.payload)
    } else {
      this.streams.delete(message.id)
      pending.reject(
        new BridgeError(
          message.error?.code ?? "E_INTERNAL",
          message.error?.message ?? "unknown bridge error"
        )
      )
    }
  }

  // ------------------------------------------------------------------ files

  async info(): Promise<AppInfo> {
    return this.send<AppInfo>("app.info", {}).result
  }

  async list(path: string): Promise<FileEntry[]> {
    return this.send<FileEntry[]>("fs.list", { path }).result
  }

  async read(path: string): Promise<string> {
    const reply = await this.send<{ content: string }>("fs.read", { path }).result
    return reply.content
  }

  async write(path: string, content: string): Promise<void> {
    await this.send("fs.write", { path, content }).result
  }

  async mkdir(path: string): Promise<void> {
    await this.send("fs.mkdir", { path }).result
  }

  async remove(path: string): Promise<void> {
    await this.send("fs.delete", { path }).result
  }

  async rename(from: string, to: string): Promise<void> {
    await this.send("fs.rename", { from, to }).result
  }

  // --------------------------------------------------------------- processes

  async run(
    argv: string[],
    cwd: string,
    onEvent: (event: ProcessEvent) => void,
    onStart?: (handle: RunHandle) => void
  ): Promise<number> {
    let finish: (code: number) => void = () => {}
    const exit = new Promise<number>((resolve) => {
      finish = resolve
    })

    const { id, result } = this.send<{ jobId: string }>("proc.run", { argv, cwd }, (event, payload) => {
      if (event === "proc.stdout") onEvent({ stream: "stdout", data: payload.data })
      else if (event === "proc.stderr") onEvent({ stream: "stderr", data: payload.data })
      else if (event === "proc.exit") finish(payload.code ?? 0)
    })

    let reply: { jobId: string }
    try {
      reply = await result
    } catch (error) {
      this.streams.delete(id)
      throw error
    }

    onStart?.({
      cancel: () => {
        void this.send("proc.cancel", { jobId: reply.jobId }).result.catch(() => {})
      }
    })

    return exit.finally(() => this.streams.delete(id))
  }

  // ----------------------------------------------------------------- theme

  async getTheme(): Promise<ThemeState> {
    return this.send<ThemeState>("app.theme.get", {}).result
  }

  async setTheme(mode: ThemeMode): Promise<ThemeState> {
    return this.send<ThemeState>("app.theme.set", { mode }).result
  }

  onThemeChanged(listener: (state: ThemeState) => void): () => void {
    this.themeListeners.add(listener)
    return () => this.themeListeners.delete(listener)
  }

  // -------------------------------------------------------------- terminal

  async openTerminal(options: TerminalOptions): Promise<TerminalHandle | null> {
    let sessionId = ""
    let closed = false
    // IME/user input arrives in small bursts; coalesce to at most one bridge
    // message per frame so typing never floods the WebView channel.
    let queued: Uint8Array[] = []
    let flushScheduled = false
    const flush = () => {
      flushScheduled = false
      if (queued.length === 0 || closed) return
      const batch = queued
      queued = []
      const total = batch.reduce((sum, part) => sum + part.length, 0)
      const joined = new Uint8Array(total)
      let offset = 0
      for (const part of batch) {
        joined.set(part, offset)
        offset += part.length
      }
      void this.send("term.write", { sessionId, b64: bytesToBase64(joined) }).result.catch(
        () => {}
      )
    }

    const { id, result } = this.send<{ sessionId: string }>(
      "term.open",
      { cwd: options.cwd, cols: options.cols, rows: options.rows },
      (event, payload) => {
        if (event === "term.data") options.onData(base64ToBytes(payload.b64 ?? ""))
        else if (event === "term.exit") {
          this.streams.delete(id)
          options.onExit(payload.code ?? -1)
        }
      }
    )

    const reply = await result
    sessionId = reply.sessionId

    return {
      sessionId,
      write: (data) => {
        if (closed || data.length === 0) return
        queued.push(data)
        if (!flushScheduled) {
          flushScheduled = true
          requestAnimationFrame(flush)
        }
      },
      resize: (cols, rows) => {
        if (closed) return
        void this.send("term.resize", { sessionId, cols, rows }).result.catch(() => {})
      },
      close: () => {
        if (closed) return
        flush()
        closed = true
        this.streams.delete(id)
        void this.send("term.close", { sessionId }).result.catch(() => {})
      }
    }
  }

  // -------------------------------------------------------- storage & SAF

  async getStorageInfo(): Promise<StorageInfo> {
    return this.send<StorageInfo>("storage.info", {}).result
  }

  async requestStoragePermission(): Promise<boolean> {
    const reply = await this.send<{ granted: boolean }>("storage.requestPermission", {}).result
    return Boolean(reply.granted)
  }

  async openSafDocument(): Promise<SafDocument | null> {
    return this.send<SafDocument | null>("saf.open", {}).result
  }

  async saveSafDocument(
    filename: string,
    content: string
  ): Promise<{ name: string; uri: string } | null> {
    return this.send<{ name: string; uri: string } | null>("saf.save", {
      name: filename,
      content
    }).result
  }
}

// --------------------------------------------------------------- base64 glue
// Terminal data is raw bytes: ANSI sequences plus possibly split UTF-8. Base64
// keeps it intact across the JSON boundary.

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  const chunk = 0x2000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]
    )
  }
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  if (!value) return new Uint8Array(0)
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
