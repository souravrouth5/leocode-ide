import {
  AppError,
  isErrorCode,
  type AppInfo,
  type BackupResult,
  type Bridge,
  type Draft,
  type DraftInfo,
  type FileEntry,
  type FileStat,
  type ProcessEvent,
  type ReadChunk,
  type RequestOptions,
  type RunHandle,
  type RuntimeInstallHandle,
  type RuntimeInstallProgress,
  type SafDocument,
  type SafExportResult,
  type SafProgress,
  type SearchMatch,
  type SearchOptions,
  type SearchSummary,
  type StorageInfo,
  type TerminalAttach,
  type TerminalAttachOptions,
  type TerminalHandle,
  type TerminalInfo,
  type TerminalOptions,
  type ThemeMode,
  type ThemeState,
  type TreeImportResult,
  type WorkspaceList,
  type WorkspaceRef,
  type WriteResult
} from "./types"
import { MAX_MESSAGE_BYTES } from "./limits"
import { isIdempotentRead, timeoutMsFor } from "./timeouts"
import {
  createBackgroundErrorReporter,
  type BackgroundErrorReporter
} from "../errors/background"

/** The object injected by WebViewCompat.addWebMessageListener. */
export interface InjectedChannel {
  postMessage: (data: string) => void
  onmessage: ((event: { data: string }) => void) | null
}

/** User-facing wording for a failed fire-and-forget call (W-23). */
export const BACKGROUND_CONTEXT = {
  terminalInput: "Terminal input is not reaching the shell",
  terminalAck: "Terminal output is not being acknowledged",
  terminalResize: "The terminal size is not reaching the shell",
  terminalClose: "The terminal could not be closed",
  stopProcess: "The process could not be stopped",
  cancelInstall: "The install could not be cancelled"
} as const

export interface AndroidBridgeOptions {
  /**
   * Fire-and-forget failures, coalesced to one report per burst (W-23). Without
   * a reporter they are logged once per burst instead of disappearing.
   */
  onBackgroundError?: (error: AppError, context: string) => void
}

function backgroundContextFor(method: string): string {
  switch (method) {
    case "term.ack":
      return BACKGROUND_CONTEXT.terminalAck
    case "term.resize":
      return BACKGROUND_CONTEXT.terminalResize
    case "term.close":
      return BACKGROUND_CONTEXT.terminalClose
    default:
      return BACKGROUND_CONTEXT.terminalInput
  }
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

interface Pending {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  cleanup: () => void
}

/**
 * The real bridge, Task 11.
 *
 * Every request carries a per-method timeout, an optional `AbortSignal` and a
 * pending slot that is always removed: a late reply after a timeout, abort or
 * disconnect is ignored instead of resolving a settled promise. Idempotent reads
 * are retried once after a timeout; writes and streams never are.
 */
const notConnected = () =>
  new AppError(
    "E_BRIDGE_DISCONNECTED",
    "The LeoCode host stopped responding. Reload the page.",
    true
  )

/**
 * The real bridge, Tasks 11 and 12 review fixes.
 *
 * Every request carries a per-method timeout, an optional `AbortSignal` and a
 * pending slot that is always removed. A late reply after a timeout or abort is
 * not just dropped: for `proc.run`, `term.open` and `runtime.install` it is used
 * to cancel/close the work the host started (W-08). After a disconnect every
 * call fails immediately and open streams receive a failure callback (W-07).
 */
export class AndroidBridge implements Bridge {
  readonly mode = "android" as const

  private seq = 0
  private readonly pending = new Map<string, Pending>()
  private readonly streams = new Map<string, StreamHandler>()
  private readonly streamFailures = new Map<string, (error: AppError) => void>()
  private readonly themeListeners = new Set<(state: ThemeState) => void>()
  private readonly onDisconnect = () => this.disconnect()
  /** Requests whose reply arrived after the client gave up, for cleanup. */
  private readonly late = new Map<
    string,
    { method: string; payload: unknown; expires: number }
  >()
  private disconnected = false
  /** Two timeouts in a row suggest the host is gone; the third disconnects. */
  private consecutiveTimeouts = 0
  private readonly background: BackgroundErrorReporter

  constructor(
    private readonly channel: InjectedChannel,
    private readonly options: AndroidBridgeOptions = {}
  ) {
    this.background = createBackgroundErrorReporter((error, context) => {
      // Keep the typed code for routing, and say what the user lost.
      const code = error instanceof AppError ? error.code : "E_INTERNAL"
      const detail = error instanceof Error ? error.message : String(error)
      const report = this.options.onBackgroundError
      if (report) {
        report(new AppError(code, `${context} (${detail})`), context)
        return
      }
      // No surface was wired (tests, a bare bridge): do not vanish either.
      console.warn(`[leocode] ${context}: ${detail}`)
    })
    channel.onmessage = (event) => this.receive(event.data)
    ;(window as any).__leocodeThemeEvent = (state: ThemeState) => {
      this.themeListeners.forEach((listener) => listener(state))
    }
    window.addEventListener("leocode:bridge-disconnected", this.onDisconnect)
  }

  /** Reject everything outstanding, for a detached WebView or renderer loss. */
  disconnect() {
    if (this.disconnected) return
    this.disconnected = true
    const outstanding = [...this.pending.values()]
    this.pending.clear()
    this.streams.clear()
    const failures = [...this.streamFailures.values()]
    this.streamFailures.clear()
    const error = notConnected()
    for (const entry of outstanding) {
      entry.cleanup()
      entry.reject(error)
    }
    for (const fail of failures) {
      try {
        fail(error)
      } catch {
        // A stream callback must not break the disconnect of the others.
      }
    }
  }

  // ------------------------------------------------------------- transport

  private checkChannel() {
    if (typeof window === "undefined") return
    const injected = window.LeoCodeAndroid
    if (injected && injected !== this.channel) this.disconnect()
  }

  private rememberLate(id: string, method: string, payload: unknown) {
    const now = Date.now()
    for (const [key, entry] of this.late) {
      if (entry.expires < now) this.late.delete(key)
    }
    this.late.set(id, { method, payload, expires: now + 60_000 })
    if (this.late.size > 50) {
      const oldest = this.late.keys().next()
      if (!oldest.done) this.late.delete(oldest.value)
    }
  }

  private send<T>(
    method: string,
    payload: unknown,
    onEvent?: StreamHandler,
    options?: RequestOptions
  ): { id: string; result: Promise<T> } {
    const id = String(++this.seq)
    this.checkChannel()
    if (this.disconnected) {
      return { id, result: Promise.reject(notConnected()) }
    }
    if (onEvent) this.streams.set(id, onEvent)

    const result = new Promise<T>((resolve, reject) => {
      const signal = options?.signal
      let timer: number | null = null
      let settled = false

      const cleanup = () => {
        if (timer !== null) {
          window.clearTimeout(timer)
          timer = null
        }
        signal?.removeEventListener("abort", onAbort)
      }

      const settle = (fn: (value: any) => void, value: unknown) => {
        if (settled) return
        settled = true
        cleanup()
        this.pending.delete(id)
        fn(value)
      }

      const fail = (error: AppError, remember: boolean) => {
        this.streams.delete(id)
        this.streamFailures.delete(id)
        if (remember) this.rememberLate(id, method, payload)
        settle(reject, error)
      }

      const onAbort = () => fail(new AppError("E_CANCELLED", `${method} was cancelled`), true)

      this.pending.set(id, {
        resolve: (value) => settle(resolve, value),
        reject: (error) => {
          this.streams.delete(id)
          this.streamFailures.delete(id)
          settle(reject, error)
        },
        cleanup
      })

      if (signal?.aborted) {
        onAbort()
        return
      }

      const timeoutMs = timeoutMsFor(method, options)
      if (timeoutMs !== null) {
        timer = window.setTimeout(() => {
          this.consecutiveTimeouts += 1
          fail(
            new AppError(
              "E_TIMEOUT",
              `${method} timed out after ${Math.round(timeoutMs / 1000)} s`,
              true
            ),
            true
          )
          if (this.consecutiveTimeouts >= 3) this.disconnect()
        }, timeoutMs)
      }
      signal?.addEventListener("abort", onAbort, { once: true })

      let text: string
      try {
        text = JSON.stringify({ v: 1, id, method, payload })
      } catch {
        fail(new AppError("E_BAD_ENVELOPE", `${method} payload is not serialisable`), false)
        return
      }
      if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) {
        fail(new AppError("E_LIMIT", `${method} is too large to send`), false)
        return
      }
      try {
        this.channel.postMessage(text)
      } catch {
        fail(new AppError("E_IO", `${method} could not be sent`), false)
      }
    })

    return { id, result }
  }

  /**
   * Sends a request, retrying an idempotent read once after a timeout. The
   * retry only happens while the caller's signal is still live.
   */
  private request<T>(
    method: string,
    payload: unknown,
    options?: RequestOptions,
    onEvent?: StreamHandler
  ): Promise<T> {
    const attempt = () => this.send<T>(method, payload, onEvent, options).result
    return attempt().catch((error: unknown) => {
      if (!this.canRetry(method, error, options)) throw error
      return attempt()
    })
  }

  private canRetry(method: string, error: unknown, options?: RequestOptions): boolean {
    if (!(error instanceof AppError) || error.code !== "E_TIMEOUT") return false
    if (!isIdempotentRead(method)) return false
    if (options?.signal?.aborted) return false
    return timeoutMsFor(method, options) !== null
  }

  private receive(raw: string) {
    let message: Reply
    try {
      message = JSON.parse(raw) as Reply
    } catch {
      return
    }

    if (message.event) {
      if (message.id) {
        const handler = this.streams.get(message.id)
        if (handler) {
          // A host payload must not throw into the window error handler (W-37).
          try {
            handler(message.event, message.payload)
          } catch {
            this.streams.delete(message.id)
            this.streamFailures.delete(message.id)
          }
        }
      }
      return
    }

    if (!message.id) return
    const pending = this.pending.get(message.id)
    if (!pending) {
      const late = this.late.get(message.id)
      if (late) {
        this.late.delete(message.id)
        if (message.ok) this.cancelLateRequest(late, message.payload)
      }
      return
    }
    this.consecutiveTimeouts = 0

    if (message.ok) {
      pending.resolve(message.payload)
    } else {
      // An unknown code from the host is a contract mismatch, not a user error.
      const code = message.error?.code
      pending.reject(
        new AppError(
          isErrorCode(code) ? code : "E_INTERNAL",
          message.error?.message ?? "unknown bridge error"
        )
      )
    }
  }

  /**
   * Sends a fire-and-forget request. Typed input, acks and resizes have no
   * caller to reject to, but a failure means the user's keystrokes are going
   * nowhere, so it is reported once per burst instead of swallowed (W-23).
   */
  private postInBackground(method: string, payload: unknown) {
    void this.request(method, payload).catch((error: unknown) => {
      this.background(error, backgroundContextFor(method))
    })
  }

  /** The client gave up; stop what the host started when the reply finally lands. */
  private cancelLateRequest(
    late: { method: string; payload: unknown },
    replyPayload: unknown
  ) {
    const reply = replyPayload as { jobId?: string; sessionId?: string } | null
    if (late.method === "proc.run" && reply?.jobId) {
      void this.request("proc.cancel", { jobId: reply.jobId }, { timeoutMs: 2_000 }).catch(
        () => {
          /* the job may already be gone */
        }
      )
    } else if (late.method === "term.open" && reply?.sessionId) {
      void this.request("term.close", { sessionId: reply.sessionId }, { timeoutMs: 2_000 }).catch(
        () => {
          /* the PTY may already be gone */
        }
      )
    } else if (late.method === "runtime.install") {
      const id = (late.payload as { id?: string } | null)?.id
      if (id) {
        void this.request("runtime.cancel", { id }, { timeoutMs: 2_000 }).catch(() => {
          /* the install may have finished */
        })
      }
    }
  }

  // ------------------------------------------------------------------ files

  async info(options?: RequestOptions): Promise<AppInfo> {
    return this.request<AppInfo>("app.info", {}, options)
  }

  async list(path: string, options?: RequestOptions): Promise<FileEntry[]> {
    return this.request<FileEntry[]>("fs.list", { path }, options)
  }

  async read(path: string, options?: RequestOptions): Promise<string> {
    const reply = await this.request<{ content: string }>("fs.read", { path }, options)
    return reply.content
  }

  async write(path: string, content: string, options?: RequestOptions): Promise<void> {
    await this.request("fs.write", { path, content }, options)
  }

  async mkdir(path: string, options?: RequestOptions): Promise<void> {
    await this.request("fs.mkdir", { path }, options)
  }

  async remove(path: string, options?: RequestOptions): Promise<void> {
    await this.request("fs.delete", { path }, options)
  }

  async rename(from: string, to: string, options?: RequestOptions): Promise<void> {
    await this.request("fs.rename", { from, to }, options)
  }

  async writeChecked(
    path: string,
    content: string,
    expectedHash: string | null,
    options?: RequestOptions
  ): Promise<WriteResult> {
    return this.request<WriteResult>(
      "fs.write",
      { path, content, expectedHash },
      options
    )
  }

  async stat(path: string, options?: RequestOptions): Promise<FileStat> {
    const reply = await this.request<Omit<FileStat, "kind"> & { kind: string }>(
      "fs.stat",
      { path },
      options
    )
    return { ...reply, kind: reply.kind === "dir" ? "dir" : "file" }
  }

  async readChunk(
    path: string,
    offset: number,
    maxBytes: number,
    options?: RequestOptions
  ): Promise<ReadChunk> {
    return this.request<ReadChunk>("fs.read", { path, offset, maxBytes }, options)
  }

  // ------------------------------------------------------------- workspaces

  async listWorkspaces(options?: RequestOptions): Promise<WorkspaceList> {
    return this.request<WorkspaceList>("workspace.list", {}, options)
  }

  async createWorkspace(name: string, options?: RequestOptions): Promise<WorkspaceRef> {
    return this.request<WorkspaceRef>("workspace.create", { name }, options)
  }

  async openWorkspace(id: string, options?: RequestOptions): Promise<WorkspaceRef> {
    return this.request<WorkspaceRef>("workspace.open", { id }, options)
  }

  async renameWorkspace(id: string, name: string, options?: RequestOptions): Promise<void> {
    await this.request("workspace.rename", { id, name }, options)
  }

  async deleteWorkspace(id: string, options?: RequestOptions): Promise<void> {
    await this.request("workspace.delete", { id }, options)
  }

  // ----------------------------------------------------------------- drafts

  async listDrafts(options?: RequestOptions): Promise<DraftInfo[]> {
    return this.request<DraftInfo[]>("draft.list", {}, options)
  }

  async readDraft(path: string, options?: RequestOptions): Promise<Draft | null> {
    return this.request<Draft | null>("draft.read", { path }, options)
  }

  async saveDraft(
    path: string,
    content: string,
    eol: string,
    options?: RequestOptions
  ): Promise<void> {
    await this.request("draft.save", { path, content, eol }, options)
  }

  async deleteDraft(path: string, options?: RequestOptions): Promise<void> {
    await this.request("draft.delete", { path }, options)
  }

  // -------------------------------------------------- workspace text search

  async search(
    query: string,
    options: SearchOptions,
    onMatch: (match: SearchMatch) => void,
    request?: RequestOptions
  ): Promise<SearchSummary> {
    return this.request<SearchSummary>(
      "fs.search",
      {
        query,
        glob: options.glob,
        caseSensitive: options.caseSensitive ?? false,
        maxResults: options.maxResults,
        searchId: options.searchId
      },
      request,
      (event, payload) => {
        if (event === "search.match") onMatch(payload as SearchMatch)
      }
    )
  }

  async cancelSearch(searchId: string, options?: RequestOptions): Promise<boolean> {
    const reply = await this.request<{ cancelled: boolean }>(
      "fs.search.cancel",
      { searchId },
      { timeoutMs: 2_000, ...options }
    )
    return Boolean(reply.cancelled)
  }

  // ------------------------------------------------------- backups & import

  async importTree(
    dest: string | null,
    onProgress: (progress: SafProgress) => void,
    options?: RequestOptions
  ): Promise<TreeImportResult | null> {
    return this.request<TreeImportResult | null>(
      "saf.importTree",
      { dest },
      options,
      (event, payload) => {
        if (event === "saf.progress") onProgress(payload as SafProgress)
      }
    )
  }

  async exportWorkspace(
    name: string | null,
    onProgress: (progress: SafProgress) => void,
    options?: RequestOptions
  ): Promise<SafExportResult | null> {
    return this.request<SafExportResult | null>(
      "saf.exportWorkspace",
      { name },
      options,
      (event, payload) => {
        if (event === "saf.progress") onProgress(payload as SafProgress)
      }
    )
  }

  async restoreArchive(
    onProgress: (progress: SafProgress) => void,
    options?: RequestOptions
  ): Promise<BackupResult | null> {
    return this.request<BackupResult | null>(
      "saf.restoreArchive",
      { confirm: true },
      options,
      (event, payload) => {
        if (event === "saf.progress") onProgress(payload as SafProgress)
      }
    )
  }

  // --------------------------------------------------------------- processes

  async run(
    argv: string[],
    cwd: string,
    onEvent: (event: ProcessEvent) => void,
    onStart?: (handle: RunHandle) => void,
    options?: RequestOptions
  ): Promise<number> {
    let finish: (code: number) => void = () => {}
    let failExit: (reason: unknown) => void = () => {}
    const exit = new Promise<number>((resolve, reject) => {
      finish = resolve
      failExit = reject
    })

    const { id, result } = this.send<{ jobId: string }>(
      "proc.run",
      { argv, cwd },
      (event, payload) => {
        if (event === "proc.stdout") onEvent({ stream: "stdout", data: payload.data })
        else if (event === "proc.stderr") onEvent({ stream: "stderr", data: payload.data })
        else if (event === "proc.exit") finish(payload.code ?? 0)
      },
      options
    )

    this.streamFailures.set(id, (error) => failExit(error))

    let reply: { jobId: string }
    try {
      reply = await result
    } catch (error) {
      this.streams.delete(id)
      this.streamFailures.delete(id)
      throw error
    }

    onStart?.({
      cancel: () => {
        void this.request("proc.cancel", { jobId: reply.jobId }).catch((error: unknown) => {
          // Best effort: the exit event is authoritative, but a failure to stop
          // a running process is worth saying once (W-23).
          this.background(error, BACKGROUND_CONTEXT.stopProcess)
        })
      }
    })

    return exit.finally(() => {
      this.streams.delete(id)
      this.streamFailures.delete(id)
    })
  }

  // ----------------------------------------------------------------- theme

  async getTheme(options?: RequestOptions): Promise<ThemeState> {
    return this.request<ThemeState>("app.theme.get", {}, options)
  }

  async setTheme(mode: ThemeMode, options?: RequestOptions): Promise<ThemeState> {
    return this.request<ThemeState>("app.theme.set", { mode }, options)
  }

  onThemeChanged(listener: (state: ThemeState) => void): () => void {
    this.themeListeners.add(listener)
    return () => this.themeListeners.delete(listener)
  }

  // -------------------------------------------------------------- terminal

  async openTerminal(
    options: TerminalOptions,
    request?: RequestOptions
  ): Promise<TerminalHandle | null> {
    const channel = new TerminalChannel(
      (method, payload) => this.postInBackground(method, payload),
      options.onData,
      options.onExit,
      false
    )

    const { id, result } = this.send<{ sessionId: string }>(
      "term.open",
      { cwd: options.cwd, cols: options.cols, rows: options.rows },
      (event, payload) => {
        if (event === "term.data") {
          channel.receive(base64ToBytes(payload.b64 ?? ""))
        } else if (event === "term.exit") {
          this.streams.delete(id)
          this.streamFailures.delete(id)
          channel.receiveExit(payload.code ?? -1)
        }
      },
      { ...request, signal: request?.signal ?? options.signal }
    )
    channel.bind(() => {
      this.streams.delete(id)
      this.streamFailures.delete(id)
    })
    this.streamFailures.set(id, () => channel.receiveExit(-1))

    let reply: { sessionId: string }
    try {
      reply = await result
    } catch (error) {
      this.streams.delete(id)
      this.streamFailures.delete(id)
      channel.detach()
      throw error
    }
    channel.setSession(reply.sessionId)
    return channel.handle()
  }

  async attachTerminal(
    sessionId: string,
    options: TerminalAttachOptions,
    request?: RequestOptions
  ): Promise<TerminalAttach | null> {
    const channel = new TerminalChannel(
      (method, payload) => this.postInBackground(method, payload),
      options.onData,
      options.onExit,
      true
    )

    const { id, result } = this.send<{
      sessionId: string
      scrollback: string
      alive: boolean
      exitCode: number
    }>(
      "term.attach",
      { sessionId },
      (event, payload) => {
        if (event === "term.data") {
          channel.receive(base64ToBytes(payload.b64 ?? ""))
        } else if (event === "term.exit") {
          this.streams.delete(id)
          this.streamFailures.delete(id)
          channel.receiveExit(payload.code ?? -1)
        }
      },
      request
    )
    channel.bind(() => {
      this.streams.delete(id)
      this.streamFailures.delete(id)
    })
    this.streamFailures.set(id, () => channel.receiveExit(-1))

    let reply: { sessionId?: string; scrollback?: string; alive?: boolean; exitCode?: number }
    try {
      reply = await result
    } catch (error) {
      this.streams.delete(id)
      this.streamFailures.delete(id)
      channel.detach()
      if (
        error instanceof AppError &&
        (error.code === "E_NOT_FOUND" || error.code === "E_BRIDGE_DISCONNECTED")
      ) {
        return null
      }
      throw error
    }

    channel.setSession(reply.sessionId || sessionId)
    // Scrollback first, then live events that arrived while the reply was in flight.
    channel.deliverScrollback(base64ToBytes(reply.scrollback ?? ""))
    channel.markReady()

    const ended = channel.exited
    const alive = Boolean(reply.alive) && ended === null
    if (!alive) channel.detach()
    return {
      handle: channel.handle(),
      alive,
      exitCode: ended ?? reply.exitCode ?? -1
    }
  }

  async listTerminals(options?: RequestOptions): Promise<TerminalInfo[]> {
    return this.request<TerminalInfo[]>("term.list", {}, options)
  }

  // --------------------------------------------------------------- runtimes

  async installRuntime(
    id: string,
    onProgress: (progress: RuntimeInstallProgress) => void,
    onStart?: (handle: RuntimeInstallHandle) => void,
    options?: RequestOptions
  ): Promise<void> {
    const { id: requestId, result } = this.send<{ installed: boolean }>(
      "runtime.install",
      { id },
      (event, payload) => {
        if (event === "runtime.progress") onProgress(payload as RuntimeInstallProgress)
      },
      options
    )

    onStart?.({
      cancel: () => {
        void this.request("runtime.cancel", { id }).catch((error: unknown) => {
          // The install's own progress/exit drives the UI; a failed cancel must
          // still be visible once (W-23).
          this.background(error, BACKGROUND_CONTEXT.cancelInstall)
        })
      }
    })

    try {
      await result
    } finally {
      this.streams.delete(requestId)
    }
  }

  // -------------------------------------------------------- storage & SAF

  async getStorageInfo(options?: RequestOptions): Promise<StorageInfo> {
    return this.request<StorageInfo>("storage.info", {}, options)
  }

  async requestStoragePermission(options?: RequestOptions): Promise<boolean> {
    const reply = await this.request<{ granted: boolean }>(
      "storage.requestPermission",
      {},
      options
    )
    return Boolean(reply.granted)
  }

  async openSafDocument(options?: RequestOptions): Promise<SafDocument | null> {
    return this.request<SafDocument | null>("saf.open", {}, options)
  }

  async saveSafDocument(
    filename: string,
    content: string,
    options?: RequestOptions
  ): Promise<{ name: string; uri: string } | null> {
    return this.request<{ name: string; uri: string } | null>(
      "saf.save",
      { name: filename, content },
      options
    )
  }
}

/**
 * One bridge stream for a terminal. Keeps the 256 KB ack window, coalesces typed
 * input to one message per frame, and can hold live data until attach has
 * delivered its scrollback reply.
 */
class TerminalChannel {
  private sessionId = ""
  private closed = false
  private ready = false
  private exitedCode: number | null = null
  private pendingAck = 0
  private queued: Uint8Array[] = []
  private flushScheduled = false
  private early: Uint8Array[] = []
  private pendingExit: number | null = null
  private detachStream: () => void = () => {}

  constructor(
    private readonly post: (method: string, payload: unknown) => void,
    private readonly onData: (bytes: Uint8Array, done?: () => void) => void,
    private readonly onExit: (code: number) => void,
    private readonly holdUntilReady: boolean
  ) {}

  bind(detachStream: () => void) {
    this.detachStream = detachStream
  }

  setSession(sessionId: string) {
    this.sessionId = sessionId
    if (this.pendingAck > 0) {
      const bytes = this.pendingAck
      this.pendingAck = 0
      this.post("term.ack", { sessionId, bytes })
    }
    if (this.queued.length > 0) this.scheduleFlush()
  }

  get exited(): number | null {
    return this.exitedCode
  }

  /** Live data; during attach this waits for [markReady]. */
  receive(bytes: Uint8Array) {
    if (this.closed || bytes.length === 0) return
    if (this.holdUntilReady && !this.ready) {
      this.early.push(bytes)
      return
    }
    this.deliver(bytes)
  }

  /** Attach scrollback is part of the reply, so it is not credited twice. */
  deliverScrollback(bytes: Uint8Array) {
    if (bytes.length === 0) return
    this.onData(bytes)
  }

  markReady() {
    if (this.ready) return
    this.ready = true
    const early = this.early
    this.early = []
    for (const chunk of early) this.deliver(chunk)
    const exit = this.pendingExit
    this.pendingExit = null
    if (exit !== null) this.finish(exit)
  }

  receiveExit(code: number) {
    if (this.closed) return
    if (this.holdUntilReady && !this.ready) {
      this.pendingExit = code
      return
    }
    this.finish(code)
  }

  write(data: Uint8Array) {
    if (this.closed || !this.sessionId || data.length === 0) return
    this.queued.push(data)
    this.scheduleFlush()
  }

  resize(cols: number, rows: number) {
    if (this.closed || !this.sessionId) return
    this.post("term.resize", { sessionId: this.sessionId, cols, rows })
  }

  detach() {
    if (this.closed) return
    this.closed = true
    this.detachStream()
  }

  close() {
    if (this.closed) return
    this.flush()
    this.closed = true
    this.detachStream()
    if (this.sessionId) this.post("term.close", { sessionId: this.sessionId })
  }

  handle(): TerminalHandle {
    return {
      sessionId: this.sessionId,
      alive: this.exitedCode === null,
      write: (data) => this.write(data),
      resize: (cols, rows) => this.resize(cols, rows),
      close: () => this.close(),
      detach: () => this.detach()
    }
  }

  private deliver(bytes: Uint8Array) {
    if (this.closed) return
    // Ack after xterm has rendered (W-20): acking on receipt means the 256 KB
    // credit window never throttles a flood.
    let acknowledged = false
    const ack = () => {
      if (acknowledged) return
      acknowledged = true
      this.ack(bytes.length)
    }
    if (this.onData.length >= 2) {
      this.onData(bytes, ack)
    } else {
      this.onData(bytes)
      ack()
    }
  }

  private ack(bytes: number) {
    if (bytes <= 0) return
    if (!this.sessionId) {
      this.pendingAck += bytes
      return
    }
    this.post("term.ack", { sessionId: this.sessionId, bytes })
  }

  private finish(code: number) {
    this.exitedCode = code
    this.closed = true
    this.detachStream()
    this.onExit(code)
  }

  private scheduleFlush() {
    if (this.flushScheduled) return
    this.flushScheduled = true
    window.requestAnimationFrame(() => this.flush())
  }

  private flush() {
    this.flushScheduled = false
    if (this.closed || !this.sessionId || this.queued.length === 0) return
    const batch = this.queued
    this.queued = []
    const total = batch.reduce((sum, part) => sum + part.length, 0)
    const joined = new Uint8Array(total)
    let offset = 0
    for (const part of batch) {
      joined.set(part, offset)
      offset += part.length
    }
    this.post("term.write", { sessionId: this.sessionId, b64: bytesToBase64(joined) })
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
