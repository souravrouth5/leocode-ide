import type {
  AppInfo as GeneratedAppInfo,
  DraftInfo as GeneratedDraftInfo,
  ErrorCode,
  FileEntry as GeneratedFileEntry,
  GitAuth as GeneratedGitAuth,
  GitBranchInfo as GeneratedGitBranchInfo,
  GitBranchListReply as GeneratedGitBranchListReply,
  GitBranchRequest,
  GitCheckoutRequest,
  GitCloneRequest,
  GitCommitInfo as GeneratedGitCommitInfo,
  GitCommitReply as GeneratedGitCommitReply,
  GitCommitRequest,
  GitConflictReply as GeneratedGitConflictReply,
  GitDiffReply as GeneratedGitDiffReply,
  GitDiffRequest,
  GitFileChange as GeneratedGitFileChange,
  GitInitRequest,
  GitLogRequest,
  GitPathsRequest,
  GitProgress as GeneratedGitProgress,
  GitRemoteInfo as GeneratedGitRemoteInfo,
  GitRemoteListReply as GeneratedGitRemoteListReply,
  GitRemoteSetRequest,
  GitResolveRequest,
  GitStatusReply as GeneratedGitStatusReply,
  GitSyncReply as GeneratedGitSyncReply,
  GitSyncRequest,
  RuntimeProgress as GeneratedRuntimeProgress,
  SafDocument as GeneratedSafDocument,
  SearchMatch as GeneratedSearchMatch,
  SecretSetRequest,
  SshHostAnswerRequest,
  SshHostPrompt as GeneratedSshHostPrompt,
  SshKeyIdRequest,
  SshKeyGenerateRequest,
  SshKeyImportRequest,
  SshKeyInfo as GeneratedSshKeyInfo,
  SshKnownHostDeleteRequest,
  SshKnownHostInfo as GeneratedSshKnownHostInfo,
  StorageInfo as GeneratedStorageInfo,
  TermInfo as GeneratedTermInfo,
  WorkspaceInfo as GeneratedWorkspaceInfo
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

/** A workspace as listed by `workspace.list`. */
export type WorkspaceInfo = GeneratedWorkspaceInfo

/** `workspace.create`/`workspace.open` reply: the record plus its directory. */
export interface WorkspaceRef {
  id: string
  name: string
  path: string
}

export interface WorkspaceList {
  active: string
  workspaces: WorkspaceInfo[]
}

export type DraftInfo = GeneratedDraftInfo

export interface Draft {
  path: string
  content: string
  eol: string
  mtime: number
}

export type SearchMatch = GeneratedSearchMatch

export interface SearchOptions {
  glob?: string
  caseSensitive?: boolean
  maxResults?: number
  /** Client-generated id, required to cancel a running search. */
  searchId?: string
}

export interface SearchSummary {
  count: number
  truncated: boolean
}

export interface FileStat {
  path: string
  kind: EntryKind
  size: number
  mtime: number
  hash: string
}

/** One chunk of a file, read with byte offsets for large-file mode. */
export interface ReadChunk {
  path: string
  content: string
  size: number
  /** Next byte offset, or -1 when the whole file has been returned. */
  nextOffset: number
  mtime: number
  hash: string
}

export interface WriteResult {
  path: string
  size: number
  mtime: number
  hash: string
}

export interface TreeImportResult {
  path: string
  files: number
  bytes: number
}

export interface BackupResult {
  files: number
  bytes: number
}

export interface SafExportResult extends BackupResult {
  name: string
  uri: string
}

export type SafProgressPhase = "import" | "export" | "restore"

export interface SafProgress {
  phase: SafProgressPhase
  files: number
  bytes: number
}

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

// ------------------------------------------------------------ Git (Tasks 21–23)

export type GitFileChange = GeneratedGitFileChange
export type GitStatus = GeneratedGitStatusReply
export type GitCommitResult = GeneratedGitCommitReply
export type GitDiff = GeneratedGitDiffReply
export type GitCommitEntry = GeneratedGitCommitInfo
export type GitBranch = GeneratedGitBranchInfo
export type GitBranchList = GeneratedGitBranchListReply
export type GitAuth = GeneratedGitAuth
export type GitRemote = GeneratedGitRemoteInfo
export type GitRemoteList = GeneratedGitRemoteListReply
export type GitSyncResult = GeneratedGitSyncReply
export type GitConflict = GeneratedGitConflictReply
export type GitProgress = GeneratedGitProgress
export type SshKey = GeneratedSshKeyInfo
export type SshHostPrompt = GeneratedSshHostPrompt
export type SshKnownHost = GeneratedSshKnownHostInfo

export type {
  GitBranchRequest,
  GitCheckoutRequest,
  GitCloneRequest,
  GitCommitRequest,
  GitDiffRequest,
  GitInitRequest,
  GitLogRequest,
  GitPathsRequest,
  GitRemoteSetRequest,
  GitResolveRequest,
  GitSyncRequest,
  SecretSetRequest,
  SshHostAnswerRequest,
  SshKeyGenerateRequest,
  SshKeyIdRequest,
  SshKeyImportRequest,
  SshKnownHostDeleteRequest
}

/** Which conflict side a block should keep. */
export type GitResolveStrategy = "ours" | "theirs"

/**
 * Request-scoped event handlers for the long Git network operations
 * (`git.progress`) and the SSH host-key prompt (`ssh.hostkey.prompt`).
 */
export interface GitStream {
  onProgress?: (progress: GitProgress) => void
  onHostKeyPrompt?: (prompt: SshHostPrompt) => void
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
  /** `fs.write` with an optimistic-concurrency baseline (Task 15). */
  writeChecked(
    path: string,
    content: string,
    expectedHash: string | null,
    options?: RequestOptions
  ): Promise<WriteResult>
  /** `fs.stat`: size, mtime and SHA-256 used for conflict detection. */
  stat(path: string, options?: RequestOptions): Promise<FileStat>
  /** `fs.read` with byte offsets for large-file mode (Task 15). */
  readChunk(
    path: string,
    offset: number,
    maxBytes: number,
    options?: RequestOptions
  ): Promise<ReadChunk>

  // ------------------------------------------------------------- workspaces
  listWorkspaces(options?: RequestOptions): Promise<WorkspaceList>
  createWorkspace(name: string, options?: RequestOptions): Promise<WorkspaceRef>
  openWorkspace(id: string, options?: RequestOptions): Promise<WorkspaceRef>
  renameWorkspace(id: string, name: string, options?: RequestOptions): Promise<void>
  deleteWorkspace(id: string, options?: RequestOptions): Promise<void>

  // ----------------------------------------------------------------- drafts
  listDrafts(options?: RequestOptions): Promise<DraftInfo[]>
  readDraft(path: string, options?: RequestOptions): Promise<Draft | null>
  saveDraft(path: string, content: string, eol: string, options?: RequestOptions): Promise<void>
  deleteDraft(path: string, options?: RequestOptions): Promise<void>

  // -------------------------------------------------- workspace text search
  search(
    query: string,
    options: SearchOptions,
    onMatch: (match: SearchMatch) => void,
    request?: RequestOptions
  ): Promise<SearchSummary>
  cancelSearch(searchId: string, options?: RequestOptions): Promise<boolean>

  // ------------------------------------------------------- backups & import
  importTree(
    dest: string | null,
    onProgress: (progress: SafProgress) => void,
    options?: RequestOptions
  ): Promise<TreeImportResult | null>
  exportWorkspace(
    name: string | null,
    onProgress: (progress: SafProgress) => void,
    options?: RequestOptions
  ): Promise<SafExportResult | null>
  restoreArchive(
    onProgress: (progress: SafProgress) => void,
    options?: RequestOptions
  ): Promise<BackupResult | null>
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

  // ------------------------------------------------------------ git (Tasks 21–23)
  gitInit(request: GitInitRequest, options?: RequestOptions): Promise<GitStatus>
  gitStatus(path?: string | null, options?: RequestOptions): Promise<GitStatus>
  gitAdd(
    path: string | null,
    paths: string[],
    options?: RequestOptions
  ): Promise<GitStatus>
  gitReset(
    path: string | null,
    paths: string[],
    options?: RequestOptions
  ): Promise<GitStatus>
  gitCommit(request: GitCommitRequest, options?: RequestOptions): Promise<GitCommitResult>
  gitDiff(request: GitDiffRequest, options?: RequestOptions): Promise<GitDiff>
  gitLog(
    path?: string | null,
    max?: number,
    options?: RequestOptions
  ): Promise<GitCommitEntry[]>
  gitBranchList(path?: string | null, options?: RequestOptions): Promise<GitBranchList>
  gitBranchCreate(
    request: GitBranchRequest,
    options?: RequestOptions
  ): Promise<GitStatus>
  gitBranchDelete(
    path: string | null,
    name: string,
    options?: RequestOptions
  ): Promise<GitStatus>
  gitCheckout(
    request: GitCheckoutRequest,
    options?: RequestOptions
  ): Promise<GitStatus>
  gitRemoteList(path?: string | null, options?: RequestOptions): Promise<GitRemoteList>
  gitRemoteSet(
    request: GitRemoteSetRequest,
    options?: RequestOptions
  ): Promise<GitRemoteList>
  gitRemoteRemove(
    path: string | null,
    name: string,
    options?: RequestOptions
  ): Promise<GitRemoteList>
  /** Long request; progress and host-key prompts arrive through [stream]. */
  gitClone(
    request: GitCloneRequest,
    stream?: GitStream,
    options?: RequestOptions
  ): Promise<GitStatus>
  gitFetch(
    request: GitSyncRequest,
    stream?: GitStream,
    options?: RequestOptions
  ): Promise<GitSyncResult>
  gitPull(
    request: GitSyncRequest,
    stream?: GitStream,
    options?: RequestOptions
  ): Promise<GitSyncResult>
  gitPush(
    request: GitSyncRequest,
    stream?: GitStream,
    options?: RequestOptions
  ): Promise<GitSyncResult>
  gitCancel(opId: string, options?: RequestOptions): Promise<boolean>
  gitConflict(
    path: string | null,
    file: string,
    options?: RequestOptions
  ): Promise<GitConflict>
  gitResolve(
    path: string | null,
    file: string,
    strategy: GitResolveStrategy,
    options?: RequestOptions
  ): Promise<GitStatus>

  // ------------------------------------------------------------------ ssh
  sshKeysList(options?: RequestOptions): Promise<SshKey[]>
  sshKeyGenerate(
    request: SshKeyGenerateRequest,
    options?: RequestOptions
  ): Promise<SshKey>
  sshKeyImport(request: SshKeyImportRequest, options?: RequestOptions): Promise<SshKey>
  sshKeyDelete(id: string, options?: RequestOptions): Promise<void>
  sshHostKeyAnswer(
    promptId: string,
    trust: boolean,
    remember?: boolean,
    options?: RequestOptions
  ): Promise<void>
  sshHostKeyList(options?: RequestOptions): Promise<SshKnownHost[]>
  sshHostKeyDelete(host: string, port?: number, options?: RequestOptions): Promise<void>

  // --------------------------------------------------------------- secrets
  secretsTokenSet(host: string, token: string, options?: RequestOptions): Promise<void>
  secretsTokenDelete(host: string, options?: RequestOptions): Promise<void>
  /** Host keys only; a stored token value never crosses the bridge. */
  secretsTokenList(options?: RequestOptions): Promise<string[]>
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
