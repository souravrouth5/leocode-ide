import type {
  AppInfo as GeneratedAppInfo,
  ErrorCode,
  FileEntry as GeneratedFileEntry,
  RuntimeProgress as GeneratedRuntimeProgress,
  SafDocument as GeneratedSafDocument,
  StorageInfo as GeneratedStorageInfo,
  TermInfo as GeneratedTermInfo
} from "./types.gen"
import type { RequestOptions } from "./timeouts"

export type { ErrorCode } from "./types.gen"
export { isErrorCode } from "./types.gen"
export type { RequestOptions } from "./timeouts"

export type EntryKind = "file" | "dir"

export type ThemeMode = "system" | "light" | "dark"
export type EffectiveTheme = "light" | "dark"

export interface ThemeState {
  mode: ThemeMode
  effective: EffectiveTheme
}

/** Generated from the Kotlin `FileEntry` DTO; only `kind` is narrowed here. */
export type FileEntry = Omit<GeneratedFileEntry, "kind"> & { kind: EntryKind }

export interface OpenFile {
  path: string
  content: string
  dirty: boolean
}

export interface ProcessEvent {
  stream: "stdout" | "stderr"
  data: string
}

/** Generated from `AppInfo`; mode/theme are narrowed to the UI unions. */
export type AppInfo = Omit<GeneratedAppInfo, "mode" | "theme"> & {
  mode: "mock" | "android"
  theme: ThemeState
}

export interface RunHandle {
  /** Ask the host to kill the process group. */
  cancel: () => void
}

export interface TerminalOptions {
  cwd: string
  cols: number
  rows: number
  /** Call `done` after the data is rendered so the host's credit window works. */
  onData: (bytes: Uint8Array, done?: () => void) => void
  onExit: (code: number) => void
  signal?: AbortSignal
}

/** Attach has no cwd/size: the PTY already exists and keeps its geometry. */
export interface TerminalAttachOptions {
  onData: (bytes: Uint8Array, done?: () => void) => void
  onExit: (code: number) => void
}

export interface TerminalHandle {
  sessionId: string
  /** False when the PTY had already exited by the time open/attach replied. */
  readonly alive: boolean
  write: (data: Uint8Array) => void
  resize: (cols: number, rows: number) => void
  /** Kill the PTY and remove the persisted session. */
  close: () => void
  /** Stop receiving events but leave the PTY alive (background/reattach). */
  detach: () => void
}

export interface TerminalAttach {
  handle: TerminalHandle
  alive: boolean
  /** Exit code when `alive` is false, otherwise -1. */
  exitCode: number
}

/** Generated from the Kotlin `TermInfo` DTO. */
export type TerminalInfo = GeneratedTermInfo

export type StorageInfo = GeneratedStorageInfo

export type SafDocument = GeneratedSafDocument

export type RuntimeInstallPhase =
  | "preparing"
  | "download"
  | "verify"
  | "extract"
  | "configure"
  | "health"
  | "done"

export type RuntimeInstallProgress = GeneratedRuntimeProgress

export interface RuntimeInstallHandle {
  cancel: () => void
}

/**
 * v1 bridge surface. Only methods listed here may cross the WebView boundary.
 * The Android implementation mirrors docs/bridge-contract.md; keep them in sync.
 */
export interface Bridge {
  readonly mode: "mock" | "android"
  info(options?: RequestOptions): Promise<AppInfo>
  list(path: string, options?: RequestOptions): Promise<FileEntry[]>
  read(path: string, options?: RequestOptions): Promise<string>
  write(path: string, content: string, options?: RequestOptions): Promise<void>
  mkdir(path: string, options?: RequestOptions): Promise<void>
  remove(path: string, options?: RequestOptions): Promise<void>
  rename(from: string, to: string, options?: RequestOptions): Promise<void>
  run(
    argv: string[],
    cwd: string,
    onEvent: (event: ProcessEvent) => void,
    onStart?: (handle: RunHandle) => void,
    options?: RequestOptions
  ): Promise<number>
  getTheme(options?: RequestOptions): Promise<ThemeState>
  setTheme(mode: ThemeMode, options?: RequestOptions): Promise<ThemeState>
  onThemeChanged(listener: (state: ThemeState) => void): () => void
  /** Real PTY. Returns null when the bridge has no terminal (browser mock). */
  openTerminal(options: TerminalOptions, request?: RequestOptions): Promise<TerminalHandle | null>
  /**
   * Reattach to a PTY that survived Activity/WebView recreation. Resolves null
   * when the session is gone, so the caller can fall back to [openTerminal].
   */
  attachTerminal?(
    sessionId: string,
    options: TerminalAttachOptions,
    request?: RequestOptions
  ): Promise<TerminalAttach | null>
  /** Live sessions, for diagnostics and the background guide. */
  listTerminals?(options?: RequestOptions): Promise<TerminalInfo[]>
  /**
   * Download and install a runtime package. Progress arrives as the install
   * advances; the returned promise resolves once the runtime is healthy and
   * active. Rejects with an AppError code (E_OFFLINE, E_DISK_FULL, ...).
   * Absent on bridges that cannot install (browser mock only).
   */
  installRuntime?(
    id: string,
    onProgress: (progress: RuntimeInstallProgress) => void,
    onStart?: (handle: RuntimeInstallHandle) => void,
    options?: RequestOptions
  ): Promise<void>
  /** Device Storage & SAF capabilities */
  getStorageInfo?(options?: RequestOptions): Promise<StorageInfo>
  requestStoragePermission?(options?: RequestOptions): Promise<boolean>
  openSafDocument?(options?: RequestOptions): Promise<SafDocument | null>
  saveSafDocument?(
    filename: string,
    content: string,
    options?: RequestOptions
  ): Promise<{ name: string; uri: string } | null>
}

/**
 * A typed bridge failure, `docs/bridge-contract.md` § Error codes.
 *
 * `code` is the generated union, so the catalog (Task 12) is exhaustive by
 * construction. `BridgeError` stays as an alias for existing imports.
 */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryable = false
  ) {
    super(message)
    this.name = "AppError"
  }
}

export const BridgeError = AppError
export type BridgeError = AppError

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark"
}
