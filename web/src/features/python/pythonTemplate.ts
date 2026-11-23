import type { Bridge } from "../../bridge/types"

export interface BridgeWithFs {
  fs: {
    write: (path: string, content: string) => Promise<unknown>
  }
}

export interface BridgeWithWrite {
  write: (path: string, content: string) => Promise<unknown>
}

/**
 * Bridge client interface supporting either `bridge.fs.write` or `bridge.write`.
 */
export type BridgeClient = BridgeWithFs | BridgeWithWrite | Bridge

/**
 * Standard template files for a New Python Project.
 */
export const PYTHON_TEMPLATE_FILES: Record<string, string> = {
  "main.py": `def main():
    print("Hello from LeoCode Python!")

if __name__ == "__main__":
    main()
`,
  "requirements.txt": "# Add project dependencies here\n",
  ".gitignore": "__pycache__/\n*.py[cod]\n.venv/\n",
  "README.md": "# Python Project\n\nCreated with LeoCode.\n"
}

/**
 * Creates standard Python project template files in targetDir (or root if not provided).
 * Uses `bridge.fs.write` (or `bridge.write` when direct write is supported).
 *
 * @param bridge Bridge client instance
 * @param targetDir Destination directory (optional, defaults to root)
 * @returns Array of created file paths
 */
export async function createPythonProjectTemplate(
  bridge: BridgeClient,
  targetDir?: string
): Promise<string[]> {
  const writeFn =
    "fs" in bridge && bridge.fs && typeof bridge.fs.write === "function"
      ? (path: string, content: string) => bridge.fs.write(path, content)
      : "write" in bridge && typeof (bridge as BridgeWithWrite).write === "function"
        ? (path: string, content: string) => (bridge as BridgeWithWrite).write(path, content)
        : null

  if (!writeFn) {
    throw new Error("BridgeClient does not provide a write method (expected fs.write or write)")
  }

  const base = targetDir && targetDir !== "." ? targetDir.replace(/\/+$/, "") : ""
  const created: string[] = []

  for (const [name, content] of Object.entries(PYTHON_TEMPLATE_FILES)) {
    const fullPath = base.length > 0 ? `${base}/${name}` : name
    await writeFn(fullPath, content)
    created.push(fullPath)
  }

  return created
}
