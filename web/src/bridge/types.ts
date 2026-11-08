export type EntryKind = "file" | "dir"

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
  mode: "mock" | "android"
}

/**
 * v1 bridge surface. Only methods listed here may cross the WebView boundary.
 * The Android implementation must mirror docs/bridge-contract.md exactly.
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
    onEvent: (event: ProcessEvent) => void
  ): Promise<number>
}
