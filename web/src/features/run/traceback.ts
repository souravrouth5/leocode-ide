/**
 * Traceback parsing and plain-language error summarisation for Python runs (Task 31).
 */

export interface TracebackFrame {
  /** File path as reported in the traceback (relative or absolute). */
  file: string
  /** 1-based line number. */
  line: number
  /** Function or scope name, e.g. "<module>", "calculate", "main". */
  function?: string
  /** Source code line if printed beneath the frame. */
  code?: string
  /** Workspace-relative path to open in the editor, or null if outside workspace. */
  workspacePath: string | null
  /** True only if this file belongs to the active workspace. */
  isWorkspaceFile: boolean
  /** The exact raw text of the frame header. */
  raw: string
}

export interface ErrorAction {
  label: string
  command?: string
  module?: string
}

export interface ErrorSummary {
  /** Error class name, e.g. "SyntaxError", "ModuleNotFoundError". */
  type: string
  /** Full error message details, e.g. "No module named 'requests'". */
  message: string
  /** Human-friendly title. */
  title: string
  /** Plain-language explanation for users. */
  description: string
  /** Optional recommended action (e.g. `pip install requests`). */
  action?: ErrorAction
}

export interface ParsedTraceback {
  frames: TracebackFrame[]
  error: ErrorSummary | null
  raw: string
}

export interface TracebackOptions {
  workspaceRoot?: string
}

/**
 * Normalize Android app-private path aliases (`/data/user/<uid>/<pkg>` and `/data/data/<pkg>`)
 * so Python tracebacks match `AppInfo.workspaceRoot` regardless of which alias Python reports.
 */
function canonicalizeAndroidAppPath(path: string): string {
  return path.replace(/^\/data\/user\/\d+\//, "/data/data/")
}

/**
 * Determine whether a file path points to a file inside the workspace root.
 * Excludes system libraries, runtime internals (/system/, /data/.../usr/lib/python...),
 * and external or escaping paths.
 */
export function isInsideWorkspace(filePath: string, workspaceRoot?: string): boolean {
  if (!filePath) return false

  const clean = filePath.trim()
  // Python pseudo-files
  if (clean.startsWith("<") && clean.endsWith(">")) return false

  // Explicitly excluded system and runtime paths
  if (clean.startsWith("/system/")) return false
  if (clean.startsWith("/proc/") || clean.startsWith("/dev/")) return false
  if (clean.includes("/usr/lib/python") || clean.includes("/lib/python")) return false

  // Paths with escaping dots (e.g. "../foo.py")
  const normalized = clean.replace(/\\/g, "/")
  const segments = normalized.split("/").filter(Boolean)
  let depth = 0
  for (const seg of segments) {
    if (seg === "..") {
      depth--
      if (depth < 0) return false
    } else if (seg !== ".") {
      depth++
    }
  }

  if (workspaceRoot) {
    const canonPath = canonicalizeAndroidAppPath(normalized)
    const canonRoot = canonicalizeAndroidAppPath(
      workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "")
    )
    if (normalized.startsWith("/")) {
      return canonPath === canonRoot || canonPath.startsWith(canonRoot + "/")
    }
    // Relative path with workspaceRoot provided
    return !normalized.startsWith("../") && depth >= 0
  }

  // When no workspaceRoot is provided:
  // Disallow absolute system-like paths
  if (normalized.startsWith("/")) {
    if (
      normalized.startsWith("/data/") ||
      normalized.startsWith("/usr/") ||
      normalized.startsWith("/etc/") ||
      normalized.startsWith("/var/") ||
      normalized.startsWith("/tmp/")
    ) {
      return false
    }
    return false
  }

  // Relative path inside project
  return !normalized.startsWith("../") && depth >= 0
}

/**
 * Convert a file path to a clean workspace-relative path if inside the workspace.
 * Returns null if the path is outside the workspace.
 */
export function toWorkspacePath(filePath: string, workspaceRoot?: string): string | null {
  if (!isInsideWorkspace(filePath, workspaceRoot)) return null

  const normalized = filePath.replace(/\\/g, "/").trim()
  if (workspaceRoot) {
    const canonPath = canonicalizeAndroidAppPath(normalized)
    const canonRoot = canonicalizeAndroidAppPath(
      workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "")
    )
    if (canonPath === canonRoot) return "."
    if (canonPath.startsWith(canonRoot + "/")) {
      return canonPath.slice(canonRoot.length + 1)
    }
  }

  if (normalized.startsWith("./")) {
    return normalized.slice(2)
  }
  return normalized
}

/**
 * Generate a friendly, plain-language explanation for Python errors.
 */
export function summarizeError(errorType: string, message: string): ErrorSummary {
  const type = errorType.trim()
  const msg = message.trim()

  switch (type) {
    case "SyntaxError": {
      return {
        type,
        message: msg,
        title: "Syntax Error",
        description:
          "Python encountered invalid syntax. Check for missing colons (:), unclosed quotes, mismatched brackets or parentheses, or typos in keywords."
      }
    }

    case "ModuleNotFoundError": {
      const match = msg.match(/No module named ['"]([^'"]+)['"]/)
      const mod = match ? match[1].split(".")[0] : null
      const installCommand = mod ? `pip install ${mod}` : "pip install <module>"
      return {
        type,
        message: msg,
        title: mod ? `Module “${mod}” Not Found` : "Missing Module",
        description: mod
          ? `The Python module “${mod}” is not installed in this environment.`
          : "A required Python module is not installed.",
        action: {
          label: installCommand,
          command: installCommand,
          module: mod ?? undefined
        }
      }
    }

    case "FileNotFoundError": {
      const match = msg.match(/No such file or directory: ['"]([^'"]+)['"]/)
      const file = match ? match[1] : null
      return {
        type,
        message: msg,
        title: "File Not Found",
        description: file
          ? `The file or directory “${file}” could not be found. Check that the name and path are spelled correctly.`
          : "The requested file or directory does not exist. Check that the path is spelled correctly."
      }
    }

    case "IndentationError": {
      return {
        type,
        message: msg,
        title: "Indentation Error",
        description:
          "Python relies on consistent indentation to define code blocks. Check that you use 4 spaces per indent level and do not mix tabs and spaces."
      }
    }

    case "ZeroDivisionError": {
      return {
        type,
        message: msg,
        title: "Division by Zero",
        description:
          "A number was divided by zero. Ensure the divisor is checked before dividing."
      }
    }

    case "NameError": {
      const match = msg.match(/name ['"]([^'"]+)['"] is not defined/)
      const name = match ? match[1] : null
      return {
        type,
        message: msg,
        title: name ? `Undefined Name “${name}”` : "Undefined Name",
        description: name
          ? `The variable or function “${name}” is not defined. Check for spelling errors or make sure it is assigned or imported before use.`
          : "A variable or function was referenced before it was defined."
      }
    }

    case "TypeError": {
      return {
        type,
        message: msg,
        title: "Type Error",
        description: "An operation or function was applied to an object of inappropriate type."
      }
    }

    case "ValueError": {
      return {
        type,
        message: msg,
        title: "Value Error",
        description: "A function received an argument that has the right type but an invalid value."
      }
    }

    case "IndexError": {
      return {
        type,
        message: msg,
        title: "Index Out of Range",
        description: "The requested index is outside the bounds of the list or sequence."
      }
    }

    case "KeyError": {
      return {
        type,
        message: msg,
        title: "Key Error",
        description: `The dictionary key ${msg || "requested"} was not found.`
      }
    }

    case "AttributeError": {
      return {
        type,
        message: msg,
        title: "Attribute Error",
        description: "The object does not have the specified attribute or method."
      }
    }

    default: {
      const title = type.replace(/([A-Z])/g, " $1").trim()
      return {
        type,
        message: msg,
        title,
        description: msg || "An unhandled exception occurred during execution."
      }
    }
  }
}

const FRAME_REGEX = /^\s*File "([^"]+)", line (\d+)(?:, in (.+))?/
const ERROR_LINE_REGEX = /^([A-Z][a-zA-Z0-9_]*(?:Error|Exception)): ?(.*)$/

/**
 * Parse Python tracebacks and error messages from run output into structured frames and summary.
 */
export function parseTraceback(
  output: string,
  options?: TracebackOptions | string
): ParsedTraceback {
  const workspaceRoot = typeof options === "string" ? options : options?.workspaceRoot
  const frames: TracebackFrame[] = []
  let error: ErrorSummary | null = null

  if (!output) {
    return { frames, error: null, raw: output }
  }

  const lines = output.split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(FRAME_REGEX)
    if (match) {
      const file = match[1]
      const lineNum = parseInt(match[2], 10)
      const func = match[3]?.trim()
      const isWorkspace = isInsideWorkspace(file, workspaceRoot)
      const workspacePath = toWorkspacePath(file, workspaceRoot)

      // Look ahead for code line
      let code: string | undefined
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1]
        if (
          nextLine.startsWith("    ") &&
          !nextLine.match(FRAME_REGEX) &&
          !nextLine.match(ERROR_LINE_REGEX) &&
          !nextLine.trim().startsWith("^")
        ) {
          code = nextLine.trim()
        }
      }

      frames.push({
        file,
        line: lineNum,
        function: func,
        code,
        workspacePath,
        isWorkspaceFile: isWorkspace,
        raw: line.trim()
      })
    }

    const errMatch = line.match(ERROR_LINE_REGEX)
    if (errMatch) {
      // Pick the last error matched (handles chained exceptions)
      error = summarizeError(errMatch[1], errMatch[2])
    }
  }

  return {
    frames,
    error,
    raw: output
  }
}
