import type { AppInfo, Bridge, FileEntry, ProcessEvent } from "./types"

interface Node {
  kind: "file" | "dir"
  content: string
  mtime: number
}

const now = () => Date.now()

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
desktop browser before the Android bridge exists.

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

export class MockBridge implements Bridge {
  readonly mode = "mock" as const
  private nodes = new Map<string, Node>(SEED)

  async info(): Promise<AppInfo> {
    return {
      app: "LeoCode",
      version: "0.0.1-mock",
      mode: "mock",
      webview: navigator.userAgent
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
    this.nodes.set(path, {
      kind: "file",
      content,
      mtime: now()
    })
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

  async run(
    argv: string[],
    cwd: string,
    onEvent: (event: ProcessEvent) => void
  ): Promise<number> {
    const emit = (data: string, stream: ProcessEvent["stream"] = "stdout") =>
      onEvent({ stream, data })

    const [cmd, ...args] = argv

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

    if (cmd === "python" && args[0] === "--version") {
      emit("Python 3.11.9 (mock — runtime not installed)\n")
      return 0
    }

    if (cmd === "python" && args[0]) {
      emit(`running ${join(cwd, args[0])} in mock runtime…\n`)
      emit("Hello, LeoCode!\n")
      return 0
    }

    if (cmd === "git" && args[0] === "status") {
      emit("On branch main\nnothing to commit, working tree clean (mock)\n")
      return 0
    }

    emit(`${cmd}: command not found (mock bridge)\n`, "stderr")
    return 127
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
}
