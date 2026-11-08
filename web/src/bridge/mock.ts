import type {
  AppInfo,
  Bridge,
  FileEntry,
  ProcessEvent,
  RunHandle,
  SafDocument,
  StorageInfo,
  TerminalHandle,
  TerminalOptions,
  ThemeMode,
  ThemeState
} from "./types"
import { isThemeMode } from "./types"

interface Node {
  kind: "file" | "dir"
  content: string
  mtime: number
}

const now = () => Date.now()
const THEME_KEY = "leocode.theme"

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

const systemDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches

export class MockBridge implements Bridge {
  readonly mode = "mock" as const
  private nodes = new Map<string, Node>(SEED)
  private themeListeners = new Set<(state: ThemeState) => void>()
  private mode_: ThemeMode

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
        size: node.content.length,
        mtime: node.mtime
      })
    }
    return entries.sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1
    )
  }

  async read(path: string): Promise<string> {
    const node = this.nodes.get(path)
    if (!node) throw new Error(`ENOENT: ${path}`)
    if (node.kind !== "file") throw new Error(`EISDIR: ${path}`)
    return node.content
  }

  async write(path: string, content: string): Promise<void> {
    const existing = this.nodes.get(path)
    this.nodes.set(path, { kind: "file", content, mtime: now() })
    if (!existing) this.ensureParents(path)
  }

  async mkdir(path: string): Promise<void> {
    this.nodes.set(path, { kind: "dir", content: "", mtime: now() })
    this.ensureParents(path)
  }

  async remove(path: string): Promise<void> {
    for (const key of [...this.nodes.keys()]) {
      if (key === path || key.startsWith(path + "/")) this.nodes.delete(key)
    }
  }

  async rename(from: string, to: string): Promise<void> {
    const moved: Array<[string, Node]> = []
    for (const [key, node] of this.nodes) {
      if (key === from) moved.push([to, node])
      else if (key.startsWith(from + "/")) moved.push([to + key.slice(from.length), node])
    }
    if (moved.length === 0) throw new Error(`ENOENT: ${from}`)
    for (const key of [...this.nodes.keys()]) {
      if (key === from || key.startsWith(from + "/")) this.nodes.delete(key)
    }
    for (const [key, node] of moved) this.nodes.set(key, node)
    this.ensureParents(to)
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
