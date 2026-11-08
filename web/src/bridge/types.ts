export type EntryKind = "file" | "dir"

export type ThemeMode = "system" | "light" | "dark"
export type EffectiveTheme = "light" | "dark"

export interface ThemeState {
  mode: ThemeMode
  effective: EffectiveTheme
}

export interface FileEntry {
  name: string
  path: string
  kind: EntryKind
  size: number
  mtime: number
}

export interface OpenFile {
  path: string
  content: string
  dirty: boolean
}

export interface ProcessEvent {
  stream: "stdout" | "stderr"
  data: string
}

export interface AppInfo {
  app: string
  version: string
  webview?: string
  abi?: string
  androidSdk?: number
  androidRelease?: string
  workspace?: string
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

export interface StorageInfo {
  hasPermission: boolean
  internalStorage: string
  downloads: string
  documents: string
  workspace: string
}

export interface SafDocument {
  name: string
  uri: string
  content: string
  size: number
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
  /** Device Storage & SAF capabilities */
  getStorageInfo?(): Promise<StorageInfo>
  requestStoragePermission?(): Promise<boolean>
  openSafDocument?(): Promise<SafDocument | null>
  saveSafDocument?(filename: string, content: string): Promise<{ name: string; uri: string } | null>
}

export class BridgeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = "BridgeError"
  }
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark"
}
