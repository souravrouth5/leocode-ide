import type {
  AppInfo as GeneratedAppInfo,
  ErrorCode,
  FileEntry as GeneratedFileEntry,
  RuntimeProgress as GeneratedRuntimeProgress,
  SafDocument as GeneratedSafDocument,
  StorageInfo as GeneratedStorageInfo
} from "./types.gen"

export type { ErrorCode } from "./types.gen"
export { isErrorCode } from "./types.gen"

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
  onData: (bytes: Uint8Array) => void
  onExit: (code: number) => void
}

export interface TerminalHandle {
  sessionId: string
  write: (data: Uint8Array) => void
  resize: (cols: number, rows: number) => void
  close: () => void
}

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
  info(): Promise<AppInfo>
  list(path: string): Promise<FileEntry[]>
  read(path: string): Promise<string>
  write(path: string, content: string): Promise<void>
  mkdir(path: string): Promise<void>
  remove(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  run(
    argv: string[],
    cwd: string,
    onEvent: (event: ProcessEvent) => void,
    onStart?: (handle: RunHandle) => void
  ): Promise<number>
  getTheme(): Promise<ThemeState>
  setTheme(mode: ThemeMode): Promise<ThemeState>
  onThemeChanged(listener: (state: ThemeState) => void): () => void
  /** Real PTY. Returns null when the bridge has no terminal (browser mock). */
  openTerminal(options: TerminalOptions): Promise<TerminalHandle | null>
  /**
   * Download and install a runtime package. Progress arrives as the install
   * advances; the returned promise resolves once the runtime is healthy and
   * active. Rejects with a BridgeError code (E_OFFLINE, E_DISK_FULL, ...).
   * Absent on bridges that cannot install (browser mock only).
   */
  installRuntime?(
    id: string,
    onProgress: (progress: RuntimeInstallProgress) => void,
    onStart?: (handle: RuntimeInstallHandle) => void
  ): Promise<void>
  /** Device Storage & SAF capabilities */
  getStorageInfo?(): Promise<StorageInfo>
  requestStoragePermission?(): Promise<boolean>
  openSafDocument?(): Promise<SafDocument | null>
  saveSafDocument?(filename: string, content: string): Promise<{ name: string; uri: string } | null>
}

export class BridgeError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string
  ) {
    super(message)
    this.name = "BridgeError"
  }
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark"
}
