import { EditorState, type Extension } from "@codemirror/state"
import {
  IndentContext,
  indentService,
  indentUnit
} from "@codemirror/language"
import { pythonLanguage } from "@codemirror/lang-python"

/**
 * Checks whether a given file path is a Python file.
 */
export function isPythonFile(path: string): boolean {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return false
  const ext = path.slice(dot).toLowerCase()
  return ext === ".py" || ext === ".pyi" || ext === ".pyw"
}

/**
 * Resolves the tab size for a file.
 * Returns 4 for Python files (per PEP 8) and defaultTabSize (default 2) for other files.
 */
export function resolveTabSize(path: string, defaultTabSize: number = 2): number {
  return isPythonFile(path) ? 4 : defaultTabSize
}

/**
 * Alias for resolveTabSize.
 */
export const getPythonTabSize = resolveTabSize

/**
 * Matches terminal / dedenting statements in Python:
 * return, pass, break, continue, raise (with optional arguments).
 * Does not match identifiers like 'password', 'returned', 'breakpoint'.
 */
export const DEDENT_KEYWORDS_RE =
  /^\s*(return(\s.*)?|pass|break|continue|raise(\s.*)?)$/

/**
 * Matches statements on the current line that should dedent to align with their parent block:
 * else:, elif ..., except ..., finally:, case ...
 */
export const CURRENT_LINE_DEDENT_RE =
  /^\s*(else:|elif(\s.*)?:|except(\s.*)?:|finally:|case(\s.*)?:)$/

/**
 * Strips comments outside of single, double, or triple quoted strings.
 */
export function stripComment(line: string): string {
  let inSingle = false
  let inDouble = false
  let inTripleSingle = false
  let inTripleDouble = false
  let escape = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\") {
      escape = true
      continue
    }

    if (ch === "'" && line.slice(i, i + 3) === "'''") {
      if (!inDouble && !inTripleDouble) {
        inTripleSingle = !inTripleSingle
        i += 2
        continue
      }
    }
    if (ch === '"' && line.slice(i, i + 3) === '"""') {
      if (!inSingle && !inTripleSingle) {
        inTripleDouble = !inTripleDouble
        i += 2
        continue
      }
    }

    if (inTripleSingle || inTripleDouble) {
      continue
    }

    if (ch === "'") {
      if (!inDouble) inSingle = !inSingle
    } else if (ch === '"') {
      if (!inSingle) inDouble = !inDouble
    } else if (ch === "#" && !inSingle && !inDouble) {
      return line.slice(0, i)
    }
  }
  return line
}

/**
 * Computes leading visual indentation for a line in spaces, expanding tabs.
 */
export function getLineIndent(line: string, tabSize: number = 4): number {
  let indent = 0
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === " ") {
      indent++
    } else if (ch === "\t") {
      indent += tabSize - (indent % tabSize)
    } else {
      break
    }
  }
  return indent
}

/**
 * Counts unclosed brackets `(`, `[`, `{` outside string literals and comments.
 */
export function countUnclosedBrackets(text: string): number {
  const stripped = stripComment(text)
  let count = 0
  let inSingle = false
  let inDouble = false
  let escape = false

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === "\\") {
      escape = true
      continue
    }
    if (ch === "'") {
      if (!inDouble) inSingle = !inSingle
      continue
    }
    if (ch === '"') {
      if (!inSingle) inDouble = !inDouble
      continue
    }
    if (inSingle || inDouble) continue

    if (ch === "(" || ch === "[" || ch === "{") {
      count++
    } else if (ch === ")" || ch === "]" || ch === "}") {
      count--
    }
  }
  return Math.max(0, count)
}

/**
 * Calculates the appropriate indentation (in spaces) for a given line in Python code.
 *
 * Rules:
 * 1. If previous non-empty line ends with ':', indent by `tabSize` (e.g. +4).
 * 2. If previous non-empty line is a dedent keyword (`return`, `pass`, `break`, `continue`, `raise`),
 *    dedent by `tabSize` (e.g. -4, min 0).
 * 3. If current line starts with `else:`, `elif`, `except`, `finally`, or `case`, dedent by `tabSize`.
 * 4. Otherwise, inherit the previous non-empty line's indentation.
 */
export function calculatePythonIndent(
  target: EditorState | string | string[],
  posOrLineIndex: number,
  tabSize: number = 4
): number {
  let lines: string[]
  let targetLineIndex: number

  if (target instanceof EditorState) {
    const line = target.doc.lineAt(posOrLineIndex)
    targetLineIndex = line.number - 1
    lines = target.doc.toString().split("\n")
  } else if (typeof target === "string") {
    lines = target.split("\n")
    targetLineIndex = posOrLineIndex
  } else {
    lines = target
    targetLineIndex = posOrLineIndex
  }

  if (targetLineIndex <= 0) return 0

  const currentLine = lines[targetLineIndex] ?? ""
  const currentStripped = stripComment(currentLine).trim()

  // Find previous non-empty line
  let prevLineText: string | null = null
  for (let i = targetLineIndex - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) {
      prevLineText = lines[i]
      break
    }
  }

  if (prevLineText === null) return 0

  const prevIndent = getLineIndent(prevLineText, tabSize)
  const prevStripped = stripComment(prevLineText).trimEnd()

  // If current line itself is an unindenting keyword (e.g. else:, elif, except, finally, case)
  if (CURRENT_LINE_DEDENT_RE.test(currentStripped)) {
    // If the immediate preceding line ended with a block colon, it belongs to the parent
    return Math.max(0, prevIndent - tabSize)
  }

  // If current line is typed with a dedent keyword and previous line did NOT end with ':'
  // (e.g. typing return / pass in an already indented block)
  if (
    DEDENT_KEYWORDS_RE.test(currentStripped) &&
    !prevStripped.endsWith(":") &&
    prevIndent >= tabSize
  ) {
    // Current line dedents if typed at start of block
    // Return base indent or prevIndent
  }

  // Rule 1: Automatically indent after line ending with ':'
  if (prevStripped.endsWith(":")) {
    return prevIndent + tabSize
  }

  // Rule 2: Dedent on newline following return, pass, break, continue, raise
  if (DEDENT_KEYWORDS_RE.test(prevStripped)) {
    return Math.max(0, prevIndent - tabSize)
  }

  // Rule 3: Check for open brackets across previous lines of current logical block
  const unclosed = countUnclosedBrackets(prevLineText)
  if (unclosed > 0) {
    return prevIndent + tabSize
  }

  // Rule 4: Default to inheriting previous indentation
  return prevIndent
}

/**
 * CodeMirror IndentContext indentService for Python.
 */
export function pythonIndentService(
  context: IndentContext,
  pos: number
): number | null | undefined {
  return calculatePythonIndent(context.state, pos, 4)
}

/**
 * Accessory snippets for the mobile keyboard toolbar when editing Python files.
 */
export interface PythonAccessorySnippet {
  label: string
  insertText: string
  description?: string
}

export const PYTHON_ACCESSORY_SNIPPETS: PythonAccessorySnippet[] = [
  { label: "def", insertText: "def ", description: "Function definition" },
  { label: "class", insertText: "class ", description: "Class definition" },
  {
    label: "main",
    insertText: 'if __name__ == "__main__":\n    ',
    description: "Main entry point block"
  },
  { label: "for", insertText: "for ", description: "For loop" },
  { label: "try", insertText: "try:\n    ", description: "Try-except block" }
]

/**
 * Configures the CodeMirror Python indentation extension:
 * - 4 spaces tab size and indent unit (PEP 8)
 * - Custom pythonIndentService for auto-indent after ':' and dedent after return/pass/break/continue/raise
 * - Indent-on-input triggers for Python dedent keywords
 * - Bracket & quote closing tuned for Python (single, double, triple quotes)
 * - Comment toggle character '#'
 */
export function pythonIndentExtension(options?: {
  tabSize?: number
}): Extension {
  const tabSize = options?.tabSize ?? 4
  const indentSpaces = " ".repeat(tabSize)

  return [
    indentUnit.of(indentSpaces),
    EditorState.tabSize.of(tabSize),
    indentService.of(pythonIndentService),
    pythonLanguage.data.of({
      closeBrackets: {
        brackets: ["(", "[", "{", "'", '"', "'''", '"""'],
        stringPrefixes: [
          "f",
          "fr",
          "rf",
          "r",
          "u",
          "b",
          "br",
          "rb",
          "F",
          "FR",
          "RF",
          "R",
          "U",
          "B",
          "BR",
          "RB"
        ]
      },
      commentTokens: { line: "#" },
      indentOnInput:
        /^\s*([}[\])]|else:|elif(\s.*)?:|except(\s.*)?:|finally:|case(\s.*)?:|return|pass|break|continue|raise)$/
    })
  ]
}
