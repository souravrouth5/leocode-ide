import type {
  AppInfo,
  BackupResult,
  Bridge,
  Draft,
  DraftInfo,
  FileEntry,
  FileStat,
  GitBranch,
  GitBranchList,
  GitBranchRequest,
  GitCheckoutRequest,
  GitCloneRequest,
  GitCommitEntry,
  GitCommitRequest,
  GitCommitResult,
  GitConflict,
  GitDiff,
  GitDiffRequest,
  GitFileChange,
  GitInitRequest,
  GitProgress,
  GitRemote,
  GitRemoteList,
  GitRemoteSetRequest,
  GitResolveStrategy,
  GitStatus,
  GitStream,
  GitSyncRequest,
  GitSyncResult,
  LanguageDescriptor,
  LanguageListReply,
  LanguagePlanRequest,
  LanguagePlanReply,
  ProcessEvent,
  PythonProjectRequest,
  PythonRequirementsResult,
  PythonStatus,
  PythonVenvResult,
  ReadChunk,
  RootLostEvent,
  RootRequestResult,
  RootStatus,
  RunHandle,
  RunOptions,
  TrustReply,
  TrustRequest,
  TrustRevokeRequest,
  RuntimeCatalogEntry,
  RuntimeInstallHandle,
  RuntimeInstallProgress,
  SafDocument,
  SafExportResult,
  SafProgress,
  SearchMatch,
  SearchOptions,
  SearchSummary,
  SshHostPrompt,
  SshKey,
  SshKeyGenerateRequest,
  SshKeyImportRequest,
  SshKnownHost,
  StorageInfo,
  TerminalAttach,
  TerminalHandle,
  TerminalInfo,
  TerminalOptions,
  ThemeMode,
  ThemeState,
  TreeImportResult,
  UpdateCheck,
  UpdateInstallHandle,
  UpdateInstallRequest,
  UpdateProgress,
  WorkspaceInfo,
  WorkspaceList,
  WorkspaceRef,
  WriteResult
} from "./types"
import { BridgeError, isThemeMode } from "./types"
interface Node {
  kind: "file" | "dir"
  content: string
  mtime: number
}

interface MockCommit {
  sha: string
  shortSha: string
  author: string
  email: string
  time: number
  message: string
  files: Map<string, string>
}

interface MockRemote {
  name: string
  url: string
  authKind: string
  username: string | null
  keyId: string | null
  /** Lives only in the mock's memory and is never returned to the UI. */
  token: string | null
}

interface MockRepo {
  root: string
  branch: string
  commits: MockCommit[]
  /** Branch name → tip sha, or null before the first commit. */
  branches: Map<string, string | null>
  /** Staged working-tree content; absent means "same as HEAD". */
  index: Map<string, string>
  /** Paths staged as deleted. */
  stagedDeletes: Set<string>
  conflicts: Map<string, { merged: string; ours: string; theirs: string }>
  remotes: Map<string, MockRemote>
  upstream: string | null
  ahead: number
  behind: number
  remoteBranches: Set<string>
}

const now = () => Date.now()
const THEME_KEY = "leocode.theme"
/** Same per-operation ceiling as the host (`fs.read`, `fs.write`, `saf.save`). */
const MAX_WRITE_BYTES = 4 * 1024 * 1024

/** Directories `SearchEngine.IGNORED_DIRECTORIES` never enters. */
const IGNORED_SEGMENTS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".gradle",
  "build",
  "dist",
  ".idea",
  ".trash",
  ".leocode-trash"
])

/** Bytes, like the host's `FileEntry.size`, not characters. */
const byteLength = (text: string) => new TextEncoder().encode(text).length

const SEED: Array<[string, Node]> = [
  [".", { kind: "dir", content: "", mtime: now() }],
  ["src", { kind: "dir", content: "", mtime: now() }],
  [
    "README.md",
    {
      kind: "file",
      mtime: now(),
      content: `# Demo project

This workspace is served by the **mock bridge**, so the UI can be developed in a
desktop browser before the Android bridge is involved.

Try the terminal: \`ls\`, \`cat main.py\`, \`python main.py\`, \`git status\`, \`help\`.
`
    }
  ],
  [
    "main.py",
    {
      kind: "file",
      mtime: now(),
      content: `"""LeoCode mock workspace."""


def greet(name: str) -> str:
    return f"Hello, {name}!"


if __name__ == "__main__":
    print(greet("LeoCode"))
`
    }
  ],
  [
    "src/app.py",
    {
      kind: "file",
      mtime: now(),
      content: `from dataclasses import dataclass


@dataclass
class Project:
    name: str
    files: int = 0

    def describe(self) -> str:
        return f"{self.name}: {self.files} files"
`
    }
  ],
  [".gitignore", { kind: "file", mtime: now(), content: "__pycache__/\n.venv/\n*.pyc\n" }]
]

const join = (base: string, name: string) => (base === "." ? name : `${base}/${name}`)
const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "."

/** Repository-relative path input: `""`, `"."` and `"/"` all mean the root. */
const normalizeRepoPath = (path?: string | null): string => {
  const trimmed = (path ?? "").replace(/^\/+|\/+$/g, "").trim()
  return trimmed === "" || trimmed === "." ? "." : trimmed
}

const repoPrefix = (root: string) => (root === "." ? "" : `${root}/`)

const repoFileKey = (root: string, file: string) =>
  root === "." ? file : `${root}/${file}`

const DEMO_IGNORED = new Set([".git", ".hg", ".svn", ".trash", ".leocode-trash"])

const randomBase64 = (bytes: number): string => {
  const data = new Uint8Array(bytes)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(data)
  } else {
    for (let index = 0; index < bytes; index++) data[index] = Math.floor(Math.random() * 256)
  }
  let binary = ""
  for (const byte of data) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const mockSha = (seed: string): string => {
  let hash = 2166136261
  for (const char of seed) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return hash.toString(16).padStart(8, "0").repeat(5).slice(0, 40)
}

const previewLine = (line: string): string => {
  const trimmed = line.trim()
  return trimmed.length <= 240 ? trimmed : trimmed.slice(0, 237) + "…"
}

/** `*`, `?` and `**` as in the host's search glob. */
const globRegExp = (glob: string): RegExp => {
  let out = "^"
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]
    if (char === "*") {
      if (glob[index + 1] === "*") {
        out += ".*"
        index += 1
      } else {
        out += "[^/]*"
      }
    } else if (char === "?") {
      out += "[^/]"
    } else if ("\\.+()|^$@%[]{}".includes(char)) {
      out += "\\" + char
    } else {
      out += char
    }
  }
  return new RegExp(out + "$", "i")
}

const systemDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches

export class MockBridge implements Bridge {
  readonly mode = "mock" as const
  private nodes = new Map<string, Node>(SEED)
  private themeListeners = new Set<(state: ThemeState) => void>()
  private readonly runtimeInstalled = new Map<string, boolean>()

  private mode_: ThemeMode
  private workspaces: WorkspaceInfo[] = [
    {
      id: "default",
      name: "Workspace",
      path: ".",
      lastOpened: now(),
      createdAt: now()
    }
  ]
  private activeWorkspace = "default"
  private drafts = new Map<string, Map<string, Draft>>()
  private activeSearches = new Set<string>()
  private cancelledSearches = new Set<string>()

  // ------------------------------------------------------------ Git & SSH demo
  /** Active workspace id → repository root → demo repository. */
  private repos = new Map<string, Map<string, MockRepo>>()
  private sshKeys: SshKey[] = []
  private knownHosts = new Map<string, SshKnownHost>()
  private tokens = new Map<string, string>()
  private pendingHostPrompts = new Map<
    string,
    {
      prompt: SshHostPrompt
      resolve: (answer: { trust: boolean; remember: boolean }) => void
    }
  >()
  private activeOps = new Set<string>()
  private cancelledOps = new Set<string>()
  private gitSequence = 0
  private keySequence = 0

  constructor() {
    const stored = localStorage.getItem(THEME_KEY)
    this.mode_ = isThemeMode(stored) ? stored : "system"
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (this.mode_ === "system") this.emitTheme()
    })
  }

  async info(): Promise<AppInfo> {
    return {
      app: "LeoCode",
      version: "0.0.1-mock",
      mode: "mock",
      webview: navigator.userAgent,
      theme: this.themeState()
    }
  }

  async diagnostics(): Promise<string> {
    return [
      "LeoCode diagnostics",
      "App       : LeoCode 0.0.1-mock (mock)",
      "Package   : dev.leocode",
      "Device    : Browser Mock",
      "Android   : mock (SDK 0, patch unknown)",
      "ABIs      : wasm",
      "WebView   : browser",
      "Page size : 4096 bytes (mock)",
      "Root      : not detected",
      "Storage   : 4096 MB free / 8192 MB total",
      "Heap max  : 256 MB",
      "Workspace : Workspace (default)",
      "Runtimes  :",
      "  python 3.14.10 (versionCode 31410) installed=false healthy=false",
      "Last crash:",
      "  none"
    ].join("\n")
  }

  /** No system share sheet in mock mode; DiagnosticsSheet falls back to copy. */
  async shareText(): Promise<boolean> {
    return false
  }

  async list(path: string): Promise<FileEntry[]> {
    const base = path === "" ? "." : path
    const entries: FileEntry[] = []
    for (const [key, node] of this.nodes) {
      if (key === "." || parentOf(key) !== base) continue
      if (node.kind === "dir" && !this.hasChildren(key)) continue
      entries.push({
        name: key.split("/").pop() ?? key,
        path: key,
        kind: node.kind,
        size: byteLength(node.content),
        mtime: node.mtime
      })
    }
    return entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1
    )
  }

  async read(path: string): Promise<string> {
    const node = this.nodes.get(path)
    // Contract codes, not ENOENT strings: store tests must exercise the same
    // branches as the real host (W-36).
    if (!node) throw new BridgeError("E_NOT_FOUND", `${path} does not exist`)
    if (node.kind !== "file") throw new BridgeError("E_NOT_DIR", `${path} is a folder`)
    if (byteLength(node.content) > MAX_WRITE_BYTES) {
      throw new BridgeError("E_LIMIT", "file is larger than 4 MB")
    }
    if (node.content.includes("\u0000")) {
      throw new BridgeError("E_BINARY", `${path} is not a text file`)
    }
    return node.content
  }

  async write(path: string, content: string): Promise<void> {
    const bytes = byteLength(content)
    if (bytes > MAX_WRITE_BYTES) {
      throw new BridgeError("E_LIMIT", `${path} is larger than the 4 MB write limit`)
    }
    const existing = this.nodes.get(path)
    if (existing?.kind === "dir") {
      throw new BridgeError("E_NOT_DIR", `${path} is a folder`)
    }
    this.nodes.set(path, { kind: "file", content, mtime: now() })
    if (!existing) this.ensureParents(path)
  }

  async mkdir(path: string): Promise<void> {
    const existing = this.nodes.get(path)
    if (existing) {
      // Idempotent for a directory, but never replace a file.
      if (existing.kind === "dir") return
      throw new BridgeError("E_EXISTS", `${path} already exists`)
    }
    // The host calls `mkdirs()`, so missing ancestors are created; a file in the
    // path is still an error.
    const parts = path.split("/").filter(Boolean)
    let current = ""
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      const node = this.nodes.get(current)
      if (!node) {
        this.nodes.set(current, { kind: "dir", content: "", mtime: now() })
      } else if (node.kind !== "dir") {
        throw new BridgeError("E_NOT_DIR", `${current} is not a folder`)
      }
    }
  }

  async remove(path: string): Promise<void> {
    if (!this.nodes.has(path)) throw new BridgeError("E_NOT_FOUND", `${path} does not exist`)
    for (const key of [...this.nodes.keys()]) {
      if (key === path || key.startsWith(path + "/")) this.nodes.delete(key)
    }
  }

  async rename(from: string, to: string): Promise<void> {
    if (!this.nodes.has(from)) throw new BridgeError("E_NOT_FOUND", `${from} does not exist`)
    // A rename never replaces an existing entry (the host replies E_EXISTS).
    if (this.nodes.has(to)) throw new BridgeError("E_EXISTS", `${to} already exists`)
    const moved: Array<[string, Node]> = []
    for (const [key, node] of this.nodes) {
      if (key === from) moved.push([to, node])
      else if (key.startsWith(from + "/")) moved.push([to + key.slice(from.length), node])
    }
    if (moved.length === 0) throw new BridgeError("E_NOT_FOUND", `${from} does not exist`)
    for (const key of [...this.nodes.keys()]) {
      if (key === from || key.startsWith(from + "/")) this.nodes.delete(key)
    }
    for (const [key, node] of moved) this.nodes.set(key, node)
    this.ensureParents(to)
  }

  async writeChecked(
    path: string,
    content: string,
    expectedHash: string | null
  ): Promise<WriteResult> {
    const existing = this.nodes.get(path)
    if (existing?.kind === "dir") {
      throw new BridgeError("E_NOT_DIR", `${path} is a folder`)
    }
    if (expectedHash !== null) {
      if (!existing || existing.kind !== "file") {
        throw new BridgeError("E_CONFLICT", `${path} changed on disk`)
      }
      if ((await this.hash(existing.content)) !== expectedHash) {
        throw new BridgeError("E_CONFLICT", `${path} changed on disk`)
      }
    }
    await this.write(path, content)
    const node = this.nodes.get(path)!
    return {
      path,
      size: byteLength(node.content),
      mtime: node.mtime,
      hash: await this.hash(node.content)
    }
  }

  async stat(path: string): Promise<FileStat> {
    const node = this.nodes.get(path)
    if (!node) throw new BridgeError("E_NOT_FOUND", `${path} does not exist`)
    return {
      path,
      kind: node.kind,
      size: node.kind === "dir" ? 0 : byteLength(node.content),
      mtime: node.mtime,
      hash: node.kind === "dir" ? "" : await this.hash(node.content)
    }
  }

  async readChunk(path: string, offset: number, maxBytes: number): Promise<ReadChunk> {
    const node = this.nodes.get(path)
    if (!node) throw new BridgeError("E_NOT_FOUND", `${path} does not exist`)
    if (node.kind !== "file") throw new BridgeError("E_NOT_DIR", `${path} is a folder`)
    if (node.content.includes("\u0000")) {
      throw new BridgeError("E_BINARY", `${path} is not a text file`)
    }
    const bytes = new TextEncoder().encode(node.content)
    const start = Math.max(0, Math.min(offset, bytes.length))
    const end =
      maxBytes > 0 ? Math.min(bytes.length, start + maxBytes) : bytes.length
    const content = new TextDecoder().decode(bytes.subarray(start, end))
    return {
      path,
      content,
      size: bytes.length,
      nextOffset: end >= bytes.length ? -1 : end,
      mtime: node.mtime,
      hash: await this.hash(node.content)
    }
  }

  // ------------------------------------------------------------- workspaces

  async listWorkspaces(): Promise<WorkspaceList> {
    const workspaces = [...this.workspaces].sort(
      (a, b) =>
        Number(b.id === "default") - Number(a.id === "default") ||
        b.lastOpened - a.lastOpened ||
        a.name.localeCompare(b.name)
    )
    return { active: this.activeWorkspace, workspaces }
  }

  async createWorkspace(name: string): Promise<WorkspaceRef> {
    const trimmed = name.trim()
    if (!trimmed) throw new BridgeError("E_BAD_ENVELOPE", "a workspace needs a name")
    const id = `ws-${this.workspaces.length + 1}`
    const record: WorkspaceInfo = {
      id,
      name: trimmed,
      path: id,
      createdAt: now(),
      lastOpened: now()
    }
    this.workspaces.push(record)
    return { id, name: record.name, path: record.path }
  }

  async openWorkspace(id: string): Promise<WorkspaceRef> {
    const record = this.workspaces.find((item) => item.id === id)
    if (!record) throw new BridgeError("E_NOT_FOUND", "no such workspace")
    record.lastOpened = now()
    if (this.activeWorkspace !== id) {
      this.activeWorkspace = id
      // A real workspace switch starts from its own directory; the mock resets
      // the demo tree so each workspace is visibly separate. Its demo Git
      // repository is reset with it, since it was built on the old node map.
      this.nodes = new Map(SEED)
      this.repos.delete(id)
    }
    return { id: record.id, name: record.name, path: record.path }
  }

  async renameWorkspace(id: string, name: string): Promise<void> {
    const record = this.workspaces.find((item) => item.id === id)
    if (!record) throw new BridgeError("E_NOT_FOUND", "no such workspace")
    const trimmed = name.trim()
    if (!trimmed) throw new BridgeError("E_BAD_ENVELOPE", "a workspace needs a name")
    record.name = trimmed
  }

  async deleteWorkspace(id: string): Promise<void> {
    if (id === "default") {
      throw new BridgeError("E_PERMISSION", "the default workspace cannot be deleted")
    }
    if (!this.workspaces.some((item) => item.id === id)) {
      throw new BridgeError("E_NOT_FOUND", "no such workspace")
    }
    this.workspaces = this.workspaces.filter((item) => item.id !== id)
    this.drafts.delete(id)
    if (this.activeWorkspace === id) this.activeWorkspace = "default"
  }

  // ----------------------------------------------------------------- drafts

  async listDrafts(): Promise<DraftInfo[]> {
    return [...(this.drafts.get(this.activeWorkspace)?.values() ?? [])]
      .map((draft) => ({
        path: draft.path,
        mtime: draft.mtime,
        // The host reports characters here, unlike `FileEntry.size` (PD-23).
        size: draft.content.length
      }))
      .sort((a, b) => b.mtime - a.mtime)
  }

  async readDraft(path: string): Promise<Draft | null> {
    return this.drafts.get(this.activeWorkspace)?.get(path) ?? null
  }

  async saveDraft(path: string, content: string, eol: string): Promise<void> {
    if (!path.trim()) throw new BridgeError("E_BAD_ENVELOPE", "path is required")
    if (byteLength(content) > MAX_WRITE_BYTES) {
      throw new BridgeError("E_LIMIT", "draft is larger than 4 MB")
    }
    let forWorkspace = this.drafts.get(this.activeWorkspace)
    if (!forWorkspace) {
      forWorkspace = new Map()
      this.drafts.set(this.activeWorkspace, forWorkspace)
    }
    forWorkspace.set(path, {
      path,
      content,
      eol: eol === "\r\n" ? "\r\n" : "\n",
      mtime: now()
    })
  }

  async deleteDraft(path: string): Promise<void> {
    this.drafts.get(this.activeWorkspace)?.delete(path)
  }

  // -------------------------------------------------- workspace text search

  async search(
    query: string,
    options: SearchOptions,
    onMatch: (match: SearchMatch) => void
  ): Promise<SearchSummary> {
    if (!query) return { count: 0, truncated: false }
    const searchId = options.searchId ?? "mock-search"
    this.activeSearches.add(searchId)
    const requested = options.maxResults
    const cap =
      requested === undefined || !Number.isFinite(requested) || requested <= 0
        ? 500
        : Math.min(requested, 2_000)
    // The host trims the pattern; a slash selects the full relative path.
    const trimmedGlob = options.glob?.trim()
    const pattern = trimmedGlob ? globRegExp(trimmedGlob) : null
    const matchPath = trimmedGlob ? trimmedGlob.includes("/") : false
    const needle = options.caseSensitive ? query : query.toLowerCase()
    let count = 0
    let truncated = false
    try {
      scan: for (const [path, node] of this.nodes) {
        if (this.cancelledSearches.has(searchId)) break
        if (node.kind !== "file") continue
        if (path.split("/").some((part) => IGNORED_SEGMENTS.has(part))) continue
        if (pattern) {
          const target = matchPath ? path : path.slice(path.lastIndexOf("/") + 1)
          if (!pattern.test(target)) continue
        }
        const lines = node.content.split("\n")
        for (let index = 0; index < lines.length; index++) {
          if (this.cancelledSearches.has(searchId)) break scan
          const haystack = options.caseSensitive ? lines[index] : lines[index].toLowerCase()
          let at = haystack.indexOf(needle)
          while (at >= 0) {
            if (this.cancelledSearches.has(searchId)) break scan
            // Only a match that would be delivered beyond the cap truncates.
            if (count >= cap) {
              truncated = true
              break scan
            }
            count += 1
            onMatch({
              path,
              line: index + 1,
              col: at + 1,
              preview: previewLine(lines[index])
            })
            at = haystack.indexOf(needle, at + Math.max(needle.length, 1))
          }
        }
      }
      return { count, truncated }
    } finally {
      this.activeSearches.delete(searchId)
      this.cancelledSearches.delete(searchId)
    }
  }

  async cancelSearch(searchId: string): Promise<boolean> {
    if (!this.activeSearches.has(searchId)) return false
    this.cancelledSearches.add(searchId)
    return true
  }

  // ------------------------------------------------------- backups & import

  async importTree(
    dest: string | null,
    onProgress: (progress: SafProgress) => void
  ): Promise<TreeImportResult | null> {
    const root = (dest ?? "imports").replace(/^\/+|\/+$/g, "") || "imports"
    const files: Array<[string, string]> = [
      ["README.md", "# Imported folder\n\nCopied from the system picker in the mock bridge.\n"],
      ["hello.py", "print('hello from an imported file')\n"]
    ]
    let bytes = 0
    this.nodes.set(root, { kind: "dir", content: "", mtime: now() })
    for (let index = 0; index < files.length; index++) {
      const [name, content] = files[index]
      this.nodes.set(`${root}/${name}`, { kind: "file", content, mtime: now() })
      bytes += byteLength(content)
      onProgress({ phase: "import", files: index + 1, bytes })
    }
    onProgress({ phase: "import", files: files.length, bytes })
    return { path: root, files: files.length, bytes }
  }

  async exportWorkspace(
    name: string | null,
    onProgress: (progress: SafProgress) => void
  ): Promise<SafExportResult | null> {
    let files = 0
    let bytes = 0
    for (const node of this.nodes.values()) {
      if (node.kind !== "file") continue
      files += 1
      bytes += byteLength(node.content)
      onProgress({ phase: "export", files, bytes })
    }
    return {
      name: name ?? "leocode-backup.zip",
      uri: `content://saf/${name ?? "leocode-backup.zip"}`,
      files,
      bytes
    }
  }

  async restoreArchive(
    onProgress: (progress: SafProgress) => void
  ): Promise<BackupResult | null> {
    const content = "# Restored backup\n\nThe mock bridge restored this file.\n"
    this.nodes.set("restored", { kind: "dir", content: "", mtime: now() })
    this.nodes.set("restored/README.md", { kind: "file", content, mtime: now() })
    const bytes = byteLength(content)
    onProgress({ phase: "restore", files: 1, bytes })
    return { files: 1, bytes }
  }

  // -------------------------------------------------------- git (Tasks 21–23)

  private repoMap(): Map<string, MockRepo> {
    let repos = this.repos.get(this.activeWorkspace)
    if (!repos) {
      repos = new Map()
      this.repos.set(this.activeWorkspace, repos)
    }
    return repos
  }

  private repoAt(path?: string | null): MockRepo | null {
    return this.repoMap().get(normalizeRepoPath(path)) ?? null
  }

  private requireRepo(path?: string | null): MockRepo {
    const repo = this.repoAt(path)
    if (!repo) {
      throw new BridgeError("E_NOT_FOUND", "That folder is not a Git repository")
    }
    return repo
  }

  private headFiles(repo: MockRepo): Map<string, string> {
    const tip = repo.branches.get(repo.branch)
    if (!tip) return new Map()
    const commit = repo.commits.find((item) => item.sha === tip)
    return commit ? new Map(commit.files) : new Map()
  }

  /** Every text file under the repository root, keyed repo-relative. */
  private workingFiles(root: string): Map<string, string> {
    const prefix = repoPrefix(root)
    const files = new Map<string, string>()
    for (const [key, node] of this.nodes) {
      if (node.kind !== "file") continue
      if (prefix && !key.startsWith(prefix)) continue
      const relative = prefix ? key.slice(prefix.length) : key
      if (!relative) continue
      if (relative.split("/").some((part) => DEMO_IGNORED.has(part))) continue
      files.set(relative, node.content)
    }
    return files
  }

  private statusFor(root: string): GitStatus {
    const repo = this.repoAt(root)
    if (!repo) {
      return { initialized: false, clean: true }
    }
    const head = this.headFiles(repo)
    const work = this.workingFiles(root)
    const staged: GitFileChange[] = []
    const changed: GitFileChange[] = []
    const untracked: GitFileChange[] = []
    const conflicts: GitFileChange[] = [...repo.conflicts.keys()].map((path) => ({
      path,
      status: "conflicted"
    }))

    for (const [path, content] of repo.index) {
      if (head.get(path) === content) continue
      staged.push({ path, status: head.has(path) ? "modified" : "added" })
    }
    for (const path of repo.stagedDeletes) {
      if (head.has(path)) staged.push({ path, status: "deleted" })
    }
    for (const [path, content] of work) {
      if (repo.conflicts.has(path)) continue
      const baseline = repo.index.has(path) ? repo.index.get(path) : head.get(path)
      if (baseline === undefined) {
        untracked.push({ path, status: "untracked" })
      } else if (baseline !== content) {
        changed.push({ path, status: "modified" })
      }
    }
    for (const path of head.keys()) {
      if (work.has(path) || repo.stagedDeletes.has(path)) continue
      if (!repo.index.has(path) || repo.index.get(path) === head.get(path)) {
        changed.push({ path, status: "deleted" })
      }
    }

    const tip = repo.branches.get(repo.branch) ?? null
    return {
      initialized: true,
      root: root === "." ? "." : root,
      branch: repo.branch,
      head: tip ? tip.slice(0, 7) : null,
      upstream: repo.upstream,
      remote: repo.upstream ? repo.upstream.split("/")[0] : null,
      ahead: repo.ahead,
      behind: repo.behind,
      staged,
      changed,
      untracked,
      conflicts,
      clean: staged.length + changed.length + untracked.length + conflicts.length === 0
    }
  }

  private remoteList(repo: MockRepo): GitRemoteList {
    const remotes: GitRemote[] = [...repo.remotes.values()].map((remote) => ({
      name: remote.name,
      url: remote.url,
      authKind: remote.authKind,
      username: remote.username,
      hasToken: Boolean(remote.token),
      keyId: remote.keyId
    }))
    return { remotes, current: remotes[0]?.name ?? null }
  }

  private applySnapshot(
    root: string,
    previous: Map<string, string>,
    next: Map<string, string>
  ) {
    for (const path of previous.keys()) {
      if (!next.has(path)) this.nodes.delete(repoFileKey(root, path))
    }
    for (const [path, content] of next) {
      this.nodes.set(repoFileKey(root, path), { kind: "file", content, mtime: now() })
    }
    this.ensureParents(repoFileKey(root, [...next.keys()][0] ?? "README.md"))
  }

  private diffText(file: string, before: string, after: string): string {
    if (before === after) return ""
    const beforeLines = before === "" ? [] : before.replace(/\n$/, "").split("\n")
    const afterLines = after === "" ? [] : after.replace(/\n$/, "").split("\n")
    const fromRange = beforeLines.length === 0 ? "0,0" : `1,${beforeLines.length}`
    const toRange = afterLines.length === 0 ? "0,0" : `1,${afterLines.length}`
    const lines = [
      `--- ${before === "" ? "/dev/null" : `a/${file}`}`,
      `+++ ${after === "" ? "/dev/null" : `b/${file}`}`,
      `@@ -${fromRange} +${toRange} @@`,
      ...beforeLines.map((line) => `-${line}`),
      ...afterLines.map((line) => `+${line}`)
    ]
    return lines.join("\n") + "\n"
  }

  private parseRemoteUrl(url: string): {
    kind: "ssh" | "https" | "none"
    host: string
    port: number
    username?: string
  } {
    if (/^https?:\/\//i.test(url)) {
      try {
        const parsed = new URL(url)
        return {
          kind: "https",
          host: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : 443,
          username: parsed.username || undefined
        }
      } catch {
        return { kind: "https", host: "", port: 443 }
      }
    }
    if (/^ssh:\/\//i.test(url)) {
      try {
        const parsed = new URL(url)
        return {
          kind: "ssh",
          host: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : 22,
          username: parsed.username || undefined
        }
      } catch {
        return { kind: "ssh", host: "", port: 22 }
      }
    }
    const scp = /^(?:([^@/]+)@)?([^:/]+):(.+)$/.exec(url)
    if (scp) {
      return { kind: "ssh", host: scp[2], port: 22, username: scp[1] }
    }
    return { kind: "none", host: "", port: 0 }
  }

  private repoNameFromUrl(url: string): string {
    const cleaned = url.replace(/[?#].*$/, "").replace(/\/+$/, "")
    const last = cleaned.split("/").pop() ?? "repository"
    const name = last.replace(/\.git$/i, "")
    return name || "repository"
  }

  /**
   * SSH host verification in the mock. The prompt blocks the clone until
   * `ssh.hostkey.answer` arrives, and a remembered trust suppresses the next
   * prompt for the same host and port.
   */
  private async ensureHostKey(
    stream: GitStream | undefined,
    host: string,
    port: number
  ): Promise<void> {
    if (!host) throw new BridgeError("E_OFFLINE", "That remote has no host name")
    const id = `${host}:${port}`
    if (this.knownHosts.has(id)) return

    const prompt: SshHostPrompt = {
      promptId: `host-${++this.gitSequence}`,
      host,
      port,
      keyType: "ssh-ed25519",
      fingerprintSha256: `SHA256:${randomBase64(32)}`,
      changed: false
    }
    const answer = new Promise<{ trust: boolean; remember: boolean }>((resolve) => {
      this.pendingHostPrompts.set(prompt.promptId, { prompt, resolve })
    })
    stream?.onHostKeyPrompt?.(prompt)
    const result = await answer
    if (!result.trust) {
      throw new BridgeError("E_AUTH", "host key rejected")
    }
    if (result.remember) {
      this.knownHosts.set(id, {
        host,
        port,
        keyType: prompt.keyType,
        fingerprint: prompt.fingerprintSha256,
        addedAt: now()
      })
    }
  }

  private async runGitProgress(
    stream: GitStream | undefined,
    op: string,
    opId: string | null | undefined,
    task: string
  ): Promise<void> {
    if (opId) this.activeOps.add(opId)
    try {
      for (let step = 0; step <= 4; step++) {
        if (opId && this.cancelledOps.has(opId)) {
          throw new BridgeError("E_CANCELLED", `${op} cancelled`)
        }
        const progress: GitProgress = {
          op,
          opId: opId ?? null,
          task,
          done: step * 25,
          total: 100
        }
        stream?.onProgress?.(progress)
        if (step < 4) await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } finally {
      if (opId) {
        this.activeOps.delete(opId)
        this.cancelledOps.delete(opId)
      }
    }
  }

  async gitInit(request: GitInitRequest): Promise<GitStatus> {
    const root = normalizeRepoPath(request.path)
    let repo = this.repoAt(root)
    if (!repo) {
      const branch = request.branch?.trim() || "main"
      repo = {
        root,
        branch,
        commits: [],
        branches: new Map([[branch, null]]),
        index: new Map(),
        stagedDeletes: new Set(),
        conflicts: new Map(),
        remotes: new Map(),
        upstream: null,
        ahead: 0,
        behind: 0,
        remoteBranches: new Set()
      }
      this.repoMap().set(root, repo)
    }
    return this.statusFor(root)
  }

  async gitStatus(path?: string | null): Promise<GitStatus> {
    return this.statusFor(normalizeRepoPath(path))
  }

  async gitAdd(path: string | null, paths: string[]): Promise<GitStatus> {
    const root = normalizeRepoPath(path)
    const repo = this.requireRepo(root)
    const work = this.workingFiles(root)
    const head = this.headFiles(repo)
    const wanted =
      paths.length === 0 || paths.some((item) => item === "." || item === "*")
        ? [...work.keys()]
        : paths.map((item) => item.replace(/^\.\/+/, ""))
    for (const file of wanted) {
      if (work.has(file)) {
        repo.index.set(file, work.get(file)!)
        repo.stagedDeletes.delete(file)
        repo.conflicts.delete(file)
      } else {
        repo.index.delete(file)
        if (head.has(file)) repo.stagedDeletes.add(file)
        else repo.stagedDeletes.delete(file)
      }
    }
    return this.statusFor(root)
  }

  async gitReset(path: string | null, paths: string[]): Promise<GitStatus> {
    const root = normalizeRepoPath(path)
    const repo = this.requireRepo(root)
    const head = this.headFiles(repo)
    const wanted =
      paths.length === 0 || paths.some((item) => item === "." || item === "*")
        ? null
        : paths.map((item) => item.replace(/^\.\/+/, ""))
    if (wanted === null) {
      repo.index.clear()
      repo.stagedDeletes.clear()
    } else {
      for (const file of wanted) {
        if (head.has(file)) repo.index.set(file, head.get(file)!)
        else repo.index.delete(file)
        repo.stagedDeletes.delete(file)
      }
    }
    return this.statusFor(root)
  }

  async gitCommit(request: GitCommitRequest): Promise<GitCommitResult> {
    const root = normalizeRepoPath(request.path)
    const repo = this.requireRepo(root)
    const message = request.message?.trim()
    if (!message) throw new BridgeError("E_BAD_ENVELOPE", "A commit needs a message")

    const status = this.statusFor(root)
    if ((status.staged ?? []).length === 0) {
      throw new BridgeError("E_CONFLICT", "There is nothing staged to commit")
    }

    const files = this.headFiles(repo)
    for (const [path, content] of repo.index) {
      if (content === files.get(path)) continue
      files.set(path, content)
    }
    for (const path of repo.stagedDeletes) files.delete(path)

    const sha = mockSha(`${now()}-${this.gitSequence++}-${repo.commits.length}`)
    const commit: MockCommit = {
      sha,
      shortSha: sha.slice(0, 7),
      author: request.authorName?.trim() || "LeoCode Demo",
      email: request.authorEmail?.trim() || "demo@leocode.local",
      time: now(),
      message,
      files
    }
    repo.commits.unshift(commit)
    repo.branches.set(repo.branch, sha)
    repo.index.clear()
    repo.stagedDeletes.clear()
    repo.conflicts.clear()
    return { sha, shortSha: commit.shortSha }
  }

  async gitDiff(request: GitDiffRequest): Promise<GitDiff> {
    const root = normalizeRepoPath(request.path)
    const repo = this.requireRepo(root)
    const head = this.headFiles(repo)
    const work = this.workingFiles(root)
    const maxBytes = request.maxBytes && request.maxBytes > 0 ? request.maxBytes : 262_144

    const beforeFor = (file: string) =>
      request.staged
        ? head.get(file) ?? ""
        : repo.index.has(file)
          ? repo.index.get(file)!
          : head.get(file) ?? ""
    const afterFor = (file: string) =>
      request.staged ? repo.index.get(file) ?? "" : work.get(file) ?? ""

    const files =
      request.file !== null && request.file !== undefined && request.file !== ""
        ? [request.file]
        : [...new Set([...head.keys(), ...repo.index.keys(), ...work.keys()])].sort()

    let diff = ""
    for (const file of files) {
      const before = beforeFor(file)
      const after = afterFor(file)
      if (before.includes("\u0000") || after.includes("\u0000")) {
        if (request.file) {
          return { file, diff: "", truncated: false, binary: true }
        }
        continue
      }
      diff += this.diffText(file, before, after)
    }
    const truncated = diff.length > maxBytes
    return {
      file: request.file ?? null,
      diff: truncated ? diff.slice(0, maxBytes) : diff,
      truncated,
      binary: false
    }
  }

  async gitLog(path?: string | null, max = 50): Promise<GitCommitEntry[]> {
    const repo = this.requireRepo(path)
    const cap = Math.min(Math.max(1, max), 200)
    return repo.commits.slice(0, cap).map((commit) => ({
      sha: commit.sha,
      shortSha: commit.shortSha,
      author: commit.author,
      email: commit.email,
      time: commit.time,
      message: commit.message
    }))
  }

  async gitBranchList(path?: string | null): Promise<GitBranchList> {
    const repo = this.requireRepo(path)
    const branches: GitBranch[] = [...repo.branches.entries()].map(([name, sha]) => ({
      name,
      current: name === repo.branch,
      remote: false,
      sha: sha ?? ""
    }))
    for (const name of repo.remoteBranches) {
      branches.push({ name, current: false, remote: true, sha: "" })
    }
    return { branches, current: repo.branch }
  }

  async gitBranchCreate(request: GitBranchRequest): Promise<GitStatus> {
    const root = normalizeRepoPath(request.path)
    const repo = this.requireRepo(root)
    const name = request.name?.trim()
    if (!name) throw new BridgeError("E_BAD_ENVELOPE", "A branch needs a name")
    if (repo.branches.has(name)) throw new BridgeError("E_EXISTS", "That branch already exists")
    const start = request.startPoint?.trim()
    let sha = repo.branches.get(repo.branch) ?? null
    if (start) {
      sha = repo.branches.get(start) ?? repo.commits.find((item) => item.sha.startsWith(start))?.sha ?? null
      if (sha === null && !repo.branches.has(start)) {
        throw new BridgeError("E_NOT_FOUND", "That start point does not exist")
      }
    }
    repo.branches.set(name, sha)
    return this.statusFor(root)
  }

  async gitBranchDelete(path: string | null, name: string): Promise<GitStatus> {
    const root = normalizeRepoPath(path)
    const repo = this.requireRepo(root)
    if (name === repo.branch) {
      throw new BridgeError("E_BUSY", "The current branch cannot be deleted")
    }
    if (!repo.branches.has(name)) throw new BridgeError("E_NOT_FOUND", "No such branch")
    repo.branches.delete(name)
    return this.statusFor(root)
  }

  async gitCheckout(request: GitCheckoutRequest): Promise<GitStatus> {
    const root = normalizeRepoPath(request.path)
    const repo = this.requireRepo(root)
    const name = request.name?.trim()
    if (!name) throw new BridgeError("E_BAD_ENVELOPE", "A branch name is required")
    if (request.create) {
      if (repo.branches.has(name)) throw new BridgeError("E_EXISTS", "That branch already exists")
      repo.branches.set(name, repo.branches.get(repo.branch) ?? null)
    } else if (!repo.branches.has(name)) {
      throw new BridgeError("E_NOT_FOUND", "No such branch")
    }
    if (name === repo.branch && !request.create) return this.statusFor(root)

    const status = this.statusFor(root)
    if ((status.staged ?? []).length + (status.changed ?? []).length + (status.conflicts ?? []).length > 0) {
      throw new BridgeError("E_CONFLICT", "Commit or stash your changes before switching branches")
    }

    const previous = this.headFiles(repo)
    repo.branch = name
    const next = this.headFiles(repo)
    this.applySnapshot(root, previous, next)
    repo.index = new Map(next)
    repo.stagedDeletes.clear()
    repo.conflicts.clear()
    return this.statusFor(root)
  }

  async gitRemoteList(path?: string | null): Promise<GitRemoteList> {
    return this.remoteList(this.requireRepo(path))
  }

  async gitRemoteSet(request: GitRemoteSetRequest): Promise<GitRemoteList> {
    const repo = this.requireRepo(request.path)
    const name = request.name?.trim()
    const url = request.url?.trim()
    if (!name) throw new BridgeError("E_BAD_ENVELOPE", "A remote needs a name")
    if (!url) throw new BridgeError("E_BAD_ENVELOPE", "A remote needs a URL")
    const existing = repo.remotes.get(name)
    const parsed = this.parseRemoteUrl(url)
    const authKind = request.authKind?.trim() || existing?.authKind || parsed.kind
    let token = existing?.token ?? null
    if (typeof request.token === "string") {
      token = request.token === "" ? null : request.token
    }
    repo.remotes.set(name, {
      name,
      url,
      authKind,
      username: request.username?.trim() || existing?.username || parsed.username || null,
      keyId: request.keyId === undefined ? existing?.keyId ?? null : request.keyId || null,
      token
    })
    return this.remoteList(repo)
  }

  async gitRemoteRemove(path: string | null, name: string): Promise<GitRemoteList> {
    const repo = this.requireRepo(path)
    if (!repo.remotes.has(name)) throw new BridgeError("E_NOT_FOUND", "No such remote")
    repo.remotes.delete(name)
    if (repo.upstream?.startsWith(`${name}/`)) repo.upstream = null
    return this.remoteList(repo)
  }

  async gitClone(
    request: GitCloneRequest,
    stream?: GitStream
  ): Promise<GitStatus> {
    const url = request.url?.trim()
    if (!url) throw new BridgeError("E_BAD_ENVELOPE", "Clone needs a repository URL")
    const name = request.name?.trim() || this.repoNameFromUrl(url)
    const base = request.path?.trim()
    const root = normalizeRepoPath(
      base && base !== "." ? (request.name?.trim() ? `${base}/${name}` : base) : name
    )
    if (root === ".") {
      throw new BridgeError("E_EXISTS", "Choose a folder for the clone")
    }
    if (this.nodes.has(root) || [...this.nodes.keys()].some((key) => key.startsWith(root + "/"))) {
      throw new BridgeError("E_EXISTS", `${root} already exists`)
    }

    const parsed = this.parseRemoteUrl(url)
    if (parsed.kind === "ssh") {
      await this.ensureHostKey(stream, parsed.host, parsed.port)
    }

    await this.runGitProgress(stream, "clone", request.opId, "Receiving objects")

    const safeUrl = url.replace(/\/\/[^@/]+@/, "//")
    const readme = `# ${name}\n\nCloned from ${safeUrl} by the LeoCode mock bridge.\n`
    const sample = `"""Mock repository ${name}."""\n\n\ndef hello() -> str:\n    return "hello from ${name}"\n`
    this.nodes.set(root, { kind: "dir", content: "", mtime: now() })
    this.nodes.set(`${root}/README.md`, { kind: "file", content: readme, mtime: now() })
    this.nodes.set(`${root}/main.py`, { kind: "file", content: sample, mtime: now() })

    const files = new Map([
      ["README.md", readme],
      ["main.py", sample]
    ])
    const sha = mockSha(`${root}-${now()}-${this.gitSequence++}`)
    const repo: MockRepo = {
      root,
      branch: "main",
      commits: [
        {
          sha,
          shortSha: sha.slice(0, 7),
          author: "LeoCode Demo",
          email: "demo@leocode.local",
          time: now(),
          message: "Initial commit",
          files
        }
      ],
      branches: new Map([["main", sha]]),
      index: new Map(files),
      stagedDeletes: new Set(),
      conflicts: new Map(),
      remotes: new Map(),
      upstream: "origin/main",
      ahead: 0,
      behind: 0,
      remoteBranches: new Set(["origin/main"])
    }
    repo.remotes.set("origin", {
      name: "origin",
      url,
      authKind: request.auth?.kind || parsed.kind,
      username: request.auth?.username?.trim() || parsed.username || null,
      keyId: request.auth?.keyId || null,
      token: request.auth?.token || null
    })
    this.repoMap().set(root, repo)
    return this.statusFor(root)
  }

  private syncRemote(repo: MockRepo, request: GitSyncRequest): string {
    const remoteName = request.remote?.trim() || repo.upstream?.split("/")[0] || this.firstRemote(repo)
    if (!remoteName) throw new BridgeError("E_NOT_FOUND", "No remote is configured")
    if (!repo.remotes.has(remoteName)) throw new BridgeError("E_NOT_FOUND", "No such remote")
    return remoteName
  }

  private firstRemote(repo: MockRepo): string | null {
    return repo.remotes.keys().next().value ?? null
  }

  private async ensureRemoteHost(repo: MockRepo, name: string, stream?: GitStream) {
    const remote = repo.remotes.get(name)
    if (!remote) return
    const parsed = this.parseRemoteUrl(remote.url)
    if (parsed.kind === "ssh") await this.ensureHostKey(stream, parsed.host, parsed.port)
  }

  async gitFetch(request: GitSyncRequest, stream?: GitStream): Promise<GitSyncResult> {
    const repo = this.requireRepo(request.path)
    const remoteName = this.syncRemote(repo, request)
    await this.ensureRemoteHost(repo, remoteName, stream)
    await this.runGitProgress(stream, "fetch", request.opId, "Resolving deltas")
    const branch = request.branch?.trim() || repo.branch
    repo.remoteBranches.add(`${remoteName}/${branch}`)
    repo.upstream = `${remoteName}/${branch}`
    return {
      branch,
      ahead: repo.ahead,
      behind: repo.behind,
      message: `Fetched ${remoteName}/${branch}`
    }
  }

  async gitPull(request: GitSyncRequest, stream?: GitStream): Promise<GitSyncResult> {
    const repo = this.requireRepo(request.path)
    const remoteName = this.syncRemote(repo, request)
    await this.ensureRemoteHost(repo, remoteName, stream)
    await this.runGitProgress(stream, "pull", request.opId, "Merging")
    const branch = request.branch?.trim() || repo.branch
    repo.upstream = `${remoteName}/${branch}`
    repo.ahead = 0
    repo.behind = 0
    return { branch, ahead: 0, behind: 0, message: "Already up to date" }
  }

  async gitPush(request: GitSyncRequest, stream?: GitStream): Promise<GitSyncResult> {
    const repo = this.requireRepo(request.path)
    const remoteName = this.syncRemote(repo, request)
    await this.ensureRemoteHost(repo, remoteName, stream)
    await this.runGitProgress(stream, "push", request.opId, "Writing objects")
    const branch = request.branch?.trim() || repo.branch
    repo.upstream = `${remoteName}/${branch}`
    repo.ahead = 0
    repo.behind = 0
    return { branch, ahead: 0, behind: 0, message: "Everything up-to-date" }
  }

  async gitCancel(opId: string): Promise<boolean> {
    if (!opId || !this.activeOps.has(opId)) return false
    this.cancelledOps.add(opId)
    return true
  }

  async gitConflict(path: string | null, file: string): Promise<GitConflict> {
    const repo = this.requireRepo(path)
    const conflict = repo.conflicts.get(file)
    if (!conflict) throw new BridgeError("E_NOT_FOUND", "That file has no conflict")
    if (conflict.merged.includes("\u0000")) {
      return {
        file,
        merged: "",
        ours: null,
        theirs: null,
        base: null,
        binary: true
      }
    }
    return {
      file,
      merged: conflict.merged,
      ours: conflict.ours,
      theirs: conflict.theirs,
      base: null,
      binary: false
    }
  }

  async gitResolve(
    path: string | null,
    file: string,
    strategy: GitResolveStrategy
  ): Promise<GitStatus> {
    const root = normalizeRepoPath(path)
    const repo = this.requireRepo(root)
    const conflict = repo.conflicts.get(file)
    if (!conflict) throw new BridgeError("E_NOT_FOUND", "That file has no conflict")
    const content = strategy === "theirs" ? conflict.theirs : conflict.ours
    this.nodes.set(repoFileKey(root, file), { kind: "file", content, mtime: now() })
    repo.index.set(file, content)
    repo.stagedDeletes.delete(file)
    repo.conflicts.delete(file)
    return this.statusFor(root)
  }

  // -------------------------------------------------------------------- ssh

  async sshKeysList(): Promise<SshKey[]> {
    return this.sshKeys.map((key) => ({ ...key }))
  }

  async sshKeyGenerate(request: SshKeyGenerateRequest): Promise<SshKey> {
    const type = request.type?.trim() || "ed25519"
    if (type !== "ed25519" && type !== "rsa" && type !== "ecdsa") {
      throw new BridgeError("E_UNSUPPORTED", "That key type is not supported")
    }
    if (type === "rsa" && request.bits && ![2048, 3072, 4096].includes(request.bits)) {
      throw new BridgeError("E_BAD_ENVELOPE", "RSA keys use 2048, 3072 or 4096 bits")
    }
    const comment = request.comment?.trim() || "leocode@device"
    const publicKey = `${type === "ed25519" ? "ssh-ed25519" : "ssh-rsa"} ${randomBase64(
      type === "ed25519" ? 32 : 128
    )} ${comment}`
    const key: SshKey = {
      id: `key-${++this.keySequence}`,
      label: request.label?.trim() || (type === "ed25519" ? "Ed25519 key" : "RSA key"),
      type,
      fingerprint: `SHA256:${randomBase64(32)}`,
      comment,
      hasPassphrase: Boolean(request.passphrase),
      createdAt: now(),
      publicKey
    }
    this.sshKeys.push(key)
    return { ...key }
  }

  async sshKeyImport(request: SshKeyImportRequest): Promise<SshKey> {
    const content = request.content?.trim()
    if (!content) throw new BridgeError("E_BAD_ENVELOPE", "Paste a private or public key first")
    const openSsh = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+)\s+(\S+)(?:\s+(.*))?$/.exec(
      content.split("\n")[0].trim()
    )
    const privateKey = content.includes("PRIVATE KEY")
    if (!openSsh && !privateKey) {
      throw new BridgeError("E_BAD_ENVELOPE", "That does not look like an SSH key")
    }
    const type = content.includes("ssh-ed25519")
      ? "ed25519"
      : content.includes("ecdsa-")
        ? "ecdsa"
        : "rsa"
    const comment = openSsh?.[3]?.trim() || "imported@device"
    const publicKey = openSsh
      ? `${openSsh[1]} ${openSsh[2]}${openSsh[3] ? ` ${openSsh[3]}` : ""}`
      : `${type === "ed25519" ? "ssh-ed25519" : "ssh-rsa"} ${randomBase64(
          type === "ed25519" ? 32 : 128
        )} ${comment}`
    const key: SshKey = {
      id: `key-${++this.keySequence}`,
      label: request.label?.trim() || "Imported key",
      type,
      fingerprint: `SHA256:${randomBase64(32)}`,
      comment,
      hasPassphrase: Boolean(request.passphrase),
      createdAt: now(),
      publicKey
    }
    this.sshKeys.push(key)
    return { ...key }
  }

  async sshKeyDelete(id: string): Promise<void> {
    const before = this.sshKeys.length
    this.sshKeys = this.sshKeys.filter((key) => key.id !== id)
    if (this.sshKeys.length === before) {
      throw new BridgeError("E_NOT_FOUND", "No such SSH key")
    }
  }

  async sshHostKeyAnswer(promptId: string, trust: boolean, remember = true): Promise<void> {
    const pending = this.pendingHostPrompts.get(promptId)
    if (!pending) throw new BridgeError("E_NOT_FOUND", "That host-key prompt has expired")
    this.pendingHostPrompts.delete(promptId)
    pending.resolve({ trust, remember })
  }

  async sshHostKeyList(): Promise<SshKnownHost[]> {
    return [...this.knownHosts.values()].map((host) => ({ ...host }))
  }

  async sshHostKeyDelete(host: string, port = 22): Promise<void> {
    this.knownHosts.delete(`${host}:${port}`)
  }

  // ---------------------------------------------------------------- secrets

  async secretsTokenSet(host: string, token: string): Promise<void> {
    const key = host?.trim()
    if (!key) throw new BridgeError("E_BAD_ENVELOPE", "A token needs a host")
    this.tokens.set(key, token)
  }

  async secretsTokenDelete(host: string): Promise<void> {
    this.tokens.delete(host)
  }

  async secretsTokenList(): Promise<string[]> {
    return [...this.tokens.keys()]
  }

  private async hash(content: string): Promise<string> {
    const bytes = new TextEncoder().encode(content)
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes)
      return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    }
    // Fallback for test environments without WebCrypto: deterministic, and only
    // compared against itself inside the mock.
    let hash = 2166136261
    for (const byte of bytes) {
      hash ^= byte
      hash = Math.imul(hash, 16777619) >>> 0
    }
    return `mock-${hash.toString(16)}`
  }

  async getTheme(): Promise<ThemeState> {
    return this.themeState()
  }

  async setTheme(mode: ThemeMode): Promise<ThemeState> {
    this.mode_ = mode
    localStorage.setItem(THEME_KEY, mode)
    this.emitTheme()
    return this.themeState()
  }

  onThemeChanged(listener: (state: ThemeState) => void): () => void {
    this.themeListeners.add(listener)
    return () => this.themeListeners.delete(listener)
  }

  async openTerminal(options: TerminalOptions): Promise<TerminalHandle | null> {
    if (options.root) {
      if (!this.rootEnabled) {
        throw new BridgeError("E_ROOT_DENIED", "root mode is not enabled")
      }
      const sessionId = `mock-term-${++this.mockSessionSeq}`
      let alive = true
      const session = {
        close: () => {
          if (!alive) return
          alive = false
          options.onExit(-1)
        }
      }
      this.mockRootSessions.set(sessionId, session)
      const handle: TerminalHandle = {
        sessionId,
        get alive() {
          return alive
        },
        write: (_data) => {},
        resize: (_cols, _rows) => {},
        close: () => {
          session.close()
          this.mockRootSessions.delete(sessionId)
        },
        detach: () => {}
      }
      return handle
    }
    return null
  }

  async attachTerminal(): Promise<TerminalAttach | null> {
    return null
  }

  async listTerminals(): Promise<TerminalInfo[]> {
    return []
  }

  lastRunOptions?: RunOptions

  async run(
    argv: string[],
    cwd: string,
    onEvent: (event: ProcessEvent) => void,
    onStart?: (handle: RunHandle) => void,
    _options?: RunOptions
  ): Promise<number> {
    this.lastRunOptions = _options
    if (_options?.root && !this.rootEnabled) {
      throw new BridgeError("E_ROOT_DENIED", "root mode is not enabled")
    }
    onStart?.({
      jobId: "mock-job-1",
      cancel: () => {},
      // The mock runtime exits immediately and never reads stdin; the run store
      // echoes the sent line into the sheet, which is what dev mode shows.
      write: () => {}
    })
    const emit = (data: string, stream: ProcessEvent["stream"] = "stdout") =>
      onEvent({ stream, data })

    const [rawCmd, ...rawArgs] = argv
    const cmd = rawCmd === "/system/bin/setsid" ? rawArgs.shift() ?? "" : rawCmd
    const args = rawArgs

    if (cmd === "pwd") {
      emit((cwd === "." ? "/workspace" : `/workspace/${cwd}`) + "\n")
      return 0
    }

    if (cmd === "ls") {
      const entries = await this.list(args[0] ?? cwd)
      emit(entries.map((e) => (e.kind === "dir" ? e.name + "/" : e.name)).join("  ") + "\n")
      return 0
    }

    if (cmd === "cat" && args[0]) {
      const target = join(cwd, args[0])
      emit((await this.read(target)) + "\n")
      return 0
    }

    if ((cmd === "python" || cmd === "python3") && args[0] === "--version") {
      emit("Python 3.11.9 (mock — runtime not installed)\n")
      return 0
    }

    if ((cmd === "python" || cmd === "python3") && args[0]) {
      emit(`running ${join(cwd, args[0])} in mock runtime…\n`)
      emit("Hello, LeoCode!\n")
      return 0
    }

    if (this.mockLanguages.some((l) => l.id === cmd) && args[0]) {
      emit(`running ${join(cwd, args[0])} in mock ${cmd}…\n`)
      emit(`Hello from mock ${cmd}!\n`)
      return 0
    }

    if ((cmd === "sh" || cmd === "/system/bin/sh") && args[0] === "-c" && args[1]) {
      const script = args[1]
      if (script.includes("toybox")) {
        emit("/system/bin/sh\ntoybox 0.8.0-android (mock)\n")
        return 0
      }
      if (script.includes("PATH=")) {
        emit("PATH=/data/data/dev.leocode/files/usr/bin:/system/bin:/system/xbin\nHOME=/data/data/dev.leocode/files/home\nPYTHONHOME=\nJAVA_HOME=\nTMPDIR=/data/data/dev.leocode/files/tmp\n")
        return 0
      }
    }

    if ((cmd === "sh" || cmd === "/system/bin/sh") && args[0]) {
      emit(`running ${join(cwd, args[0])} with sh (mock — no real exec)\n`)
      emit("hello from mock shell\n")
      return 0
    }

    if (cmd === "git" && args[0] === "status") {
      emit("On branch main\nnothing to commit, working tree clean (mock)\n")
      return 0
    }

    emit(`${cmd}: command not found (mock bridge)\n`, "stderr")
    return 127
  }

  // --------------------------------------------------------------- runtimes

  async repairRuntime(
    id: string,
    onProgress: (progress: RuntimeInstallProgress) => void,
    onStart?: (handle: RuntimeInstallHandle) => void
  ): Promise<void> {
    // The real host keeps the old tree until the new one is healthy; the mock
    // simply runs the same phase sequence again.
    return this.installRuntime(id, onProgress, onStart)
  }

  async catalogRuntimes(): Promise<RuntimeCatalogEntry[]> {
    const installed = this.runtimeInstalled.get("python") ?? false
    return [
      {
        id: "python",
        version: "3.14.10",
        versionCode: 31410,
        installed,
        healthy: installed,
        installedVersionCode: installed ? 31410 : null
      }
    ]
  }

  async uninstallRuntime(id: string): Promise<void> {
    if (id !== "python") {
      throw new BridgeError("E_NOT_FOUND", `${id} is not installed`)
    }
    if (!(this.runtimeInstalled.get(id) ?? false)) {
      throw new BridgeError("E_NOT_FOUND", `${id} is not installed`)
    }
    this.runtimeInstalled.set(id, false)
  }

  /** The mock is always current; it never downloads an APK. */
  async checkForUpdate(): Promise<UpdateCheck> {
    return {
      available: false,
      currentVersion: "0.0.1-mock",
      versionName: "0.0.1-mock",
      versionCode: 1,
      notes: "Mock mode does not update itself.",
      url: null,
      sha256: null,
      size: null
    }
  }

  async installUpdate(
    _request: UpdateInstallRequest,
    _onProgress: (progress: UpdateProgress) => void,
    _onStart?: (handle: UpdateInstallHandle) => void
  ): Promise<void> {
    throw new BridgeError("E_UNSUPPORTED", "the browser mock cannot install an APK")
  }

  // ------------------------------------------------------ trust (Task 26)

  async trustCheck(_request: TrustRequest): Promise<TrustReply> {
    return { trusted: true, action: _request.action ?? "script", fingerprint: "mock" }
  }

  async trustGrant(request: TrustRequest): Promise<TrustReply> {
    return { trusted: true, action: request.action ?? "script", fingerprint: "mock" }
  }

  async trustRevoke(request: TrustRevokeRequest): Promise<TrustReply> {
    return { trusted: false, action: request.action ?? "", fingerprint: "" }
  }

  // ----------------------------------------------------- python (Task 26)

  private mockPythonStatus(): PythonStatus {
    return {
      runtimeInstalled: true,
      runtimePython: "python3",
      venvExists: true,
      venvPath: ".venv",
      venvPython: "python3",
      requirementsExists: false,
      requirementsPath: null,
      requirementsHash: null,
      requirementsInstalled: false,
      aliasesReady: true
    }
  }

  async pythonStatus(_request?: PythonProjectRequest): Promise<PythonStatus> {
    return this.mockPythonStatus()
  }

  async pythonCreateVenv(_request?: PythonProjectRequest): Promise<PythonVenvResult> {
    return { created: false, status: this.mockPythonStatus() }
  }

  async pythonRemoveVenv(_request?: PythonProjectRequest): Promise<PythonStatus> {
    return this.mockPythonStatus()
  }

  async pythonInstallRequirements(
    _request: PythonProjectRequest | undefined,
    onLine: (line: string) => void
  ): Promise<PythonRequirementsResult> {
    onLine("Requirement already satisfied (mock)")
    return { ok: true, exitCode: 0, output: "Requirement already satisfied (mock)\n" }
  }

  // ---------------------------------------------------- language (Task 30)

  private mockLanguages: LanguageDescriptor[] = [
    {
      id: "python",
      displayName: "Python",
      extensions: ["py"],
      runtimeId: "python",
      supportsRepl: true,
      trustTriggers: ["script", "venv", "pip"],
      templateFiles: ["main.py", "requirements.txt", ".gitignore", "README.md"],
      requiresRuntime: true
    }
  ]

  setMockLanguages(languages: LanguageDescriptor[]): void {
    this.mockLanguages = [...languages]
  }

  async languageList(): Promise<LanguageListReply> {
    return { languages: this.mockLanguages }
  }

  async languagePlan(request: LanguagePlanRequest): Promise<LanguagePlanReply> {
    const ext = request.file.split(".").pop()?.toLowerCase() ?? ""
    const provider = this.mockLanguages.find(lang => lang.extensions.map(e => e.toLowerCase()).includes(ext))
    if (!provider) {
      throw new BridgeError("E_UNSUPPORTED", `No language provider registered for file: ${request.file}`)
    }
    if (provider.id === "python") {
      const status = this.mockPythonStatus()
      const interpreter = status.venvPython ?? status.runtimePython ?? "/data/user/0/dev.leocode/files/usr/bin/python3"
      return {
        languageId: "python",
        argv: [interpreter, request.file],
        env: {
          PATH: "/data/user/0/dev.leocode/files/usr/bin:/system/bin",
          PYTHONHOME: "/data/user/0/dev.leocode/files/usr"
        },
        cwd: null,
        trustAction: "script"
      }
    }
    return {
      languageId: provider.id,
      argv: [provider.id, request.file],
      env: {},
      cwd: null,
      trustAction: "script"
    }
  }

  async installRuntime(
    id: string,
    onProgress: (progress: RuntimeInstallProgress) => void,
    onStart?: (handle: RuntimeInstallHandle) => void
  ): Promise<void> {
    if (id !== "python") {
      throw new BridgeError("E_UNSUPPORTED", `${id} has no package in the mock bridge`)
    }

    let cancelled = false
    onStart?.({ cancel: () => { cancelled = true } })

    // Mirror the real phase sequence so the UI can be exercised in a browser.
    const steps: RuntimeInstallProgress[] = [
      { phase: "preparing", bytes: 0, total: 0, message: "Preparing python 3.14.10" },
      { phase: "download", bytes: 0, total: 23_027_305, message: "Downloading 0.0 MB of 22.0 MB" },
      { phase: "download", bytes: 23_027_305, total: 23_027_305, message: "Downloaded 22.0 MB" },
      { phase: "verify", bytes: 0, total: 23_027_305, message: "Verifying SHA-256" },
      { phase: "extract", bytes: 0, total: 0, message: "Extracting package" },
      { phase: "configure", bytes: 0, total: 0, message: "Bootstrapping pip" },
      { phase: "health", bytes: 0, total: 0, message: "Health check passed: 3.14.10" },
      { phase: "done", bytes: 0, total: 0, message: "python 3.14.10 installed" }
    ]

    for (const step of steps) {
      if (cancelled) throw new BridgeError("E_CANCELLED", "install cancelled")
      onProgress(step)
      await new Promise((resolve) => setTimeout(resolve, 220))
    }
    this.runtimeInstalled.set(id, true)
  }

  private themeState(): ThemeState {
    return {
      mode: this.mode_,
      effective:
        this.mode_ === "system" ? (systemDark() ? "dark" : "light") : this.mode_
    }
  }

  private emitTheme() {
    const state = this.themeState()
    this.themeListeners.forEach((listener) => listener(state))
  }

  private hasChildren(dir: string): boolean {
    for (const key of this.nodes.keys()) {
      if (key !== dir && parentOf(key) === dir) return true
    }
    return false
  }

  private ensureParents(path: string): void {
    const parts = path.split("/")
    parts.pop()
    let current = ""
    for (const part of parts) {
      current = current ? `${current}/${part}` : part
      if (!this.nodes.has(current)) {
        this.nodes.set(current, { kind: "dir", content: "", mtime: now() })
      }
    }
  }

  async getStorageInfo(): Promise<StorageInfo> {
    return {
      hasPermission: true,
      internalStorage: "/storage/emulated/0",
      downloads: "/storage/emulated/0/Download",
      documents: "/storage/emulated/0/Documents",
      workspace: "."
    }
  }

  async requestStoragePermission(): Promise<boolean> {
    return true
  }

  async openSafDocument(): Promise<SafDocument | null> {
    return {
      name: "saf-sample.py",
      uri: "content://saf/sample.py",
      content: "# Opened via Storage Access Framework\nprint('SAF works!')\n",
      size: 58
    }
  }

  async saveSafDocument(
    filename: string,
    _content: string
  ): Promise<{ name: string; uri: string } | null> {
    return {
      name: filename,
      uri: `content://saf/${filename}`
    }
  }

  // ------------------------------------------------------------------ root (Tasks 17–18)

  private rootAvailable = true
  private rootGranted = false
  private rootEnabled = false
  private mockSessionSeq = 0
  private readonly mockRootSessions = new Map<string, { close: () => void }>()
  private readonly rootLostListeners = new Set<(event: RootLostEvent) => void>()

  emitRootLost(event: RootLostEvent): void {
    this.rootLostListeners.forEach((l) => l(event))
  }

  async rootStatus(): Promise<RootStatus> {
    return {
      available: this.rootAvailable,
      granted: this.rootGranted,
      enabled: this.rootEnabled
    }
  }

  async rootRequest(): Promise<RootRequestResult> {
    if (!this.rootAvailable) {
      throw new BridgeError("E_ROOT_UNAVAILABLE", "root is not available")
    }
    this.rootGranted = true
    this.rootEnabled = true
    return { granted: true }
  }

  async rootDisable(): Promise<RootStatus> {
    this.rootEnabled = false
    this.rootGranted = false
    for (const [, session] of this.mockRootSessions) {
      session.close()
    }
    this.mockRootSessions.clear()
    return {
      available: this.rootAvailable,
      granted: this.rootGranted,
      enabled: this.rootEnabled
    }
  }

  onRootLost(listener: (event: RootLostEvent) => void): () => void {
    this.rootLostListeners.add(listener)
    return () => this.rootLostListeners.delete(listener)
  }
}
