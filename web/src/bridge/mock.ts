import type {
  AppInfo,
  BackupResult,
  Bridge,
  Draft,
  DraftInfo,
  FileEntry,
  FileStat,
  ProcessEvent,
  ReadChunk,
  RunHandle,
  RuntimeInstallHandle,
  RuntimeInstallProgress,
  SafDocument,
  SafExportResult,
  SafProgress,
  SearchMatch,
  SearchOptions,
  SearchSummary,
  StorageInfo,
  TerminalAttach,
  TerminalHandle,
  TerminalInfo,
  TerminalOptions,
  ThemeMode,
  ThemeState,
  TreeImportResult,
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
    // mkdir does not create missing ancestors; a file cannot be a parent.
    const parentPath = parentOf(path)
    if (parentPath !== ".") {
      const parent = this.nodes.get(parentPath)
      if (!parent) throw new BridgeError("E_NOT_FOUND", `${parentPath} does not exist`)
      if (parent.kind !== "dir") {
        throw new BridgeError("E_NOT_DIR", `${parentPath} is not a folder`)
      }
    }
    this.nodes.set(path, { kind: "dir", content: "", mtime: now() })
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
      // the demo tree so each workspace is visibly separate.
      this.nodes = new Map(SEED)
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

  async openTerminal(_options: TerminalOptions): Promise<TerminalHandle | null> {
    return null
  }

  async attachTerminal(): Promise<TerminalAttach | null> {
    return null
  }

  async listTerminals(): Promise<TerminalInfo[]> {
    return []
  }

  async run(
    argv: string[],
    cwd: string,
    onEvent: (event: ProcessEvent) => void,
    onStart?: (handle: RunHandle) => void
  ): Promise<number> {
    onStart?.({ cancel: () => {} })
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
}
