import { describe, expect, it } from "vitest"
import { EditorState } from "@codemirror/state"
import { getIndentation, IndentContext, indentUnit } from "@codemirror/language"
import { python } from "@codemirror/lang-python"
import {
  CURRENT_LINE_DEDENT_RE,
  DEDENT_KEYWORDS_RE,
  PYTHON_ACCESSORY_SNIPPETS,
  calculatePythonIndent,
  countUnclosedBrackets,
  getLineIndent,
  getPythonTabSize,
  isPythonFile,
  pythonIndentExtension,
  resolveTabSize,
  stripComment
} from "./pythonIndent"

describe("Python Indentation & Tab Size (Task 33)", () => {
  describe("isPythonFile & resolveTabSize", () => {
    it("identifies python files by extension", () => {
      expect(isPythonFile("main.py")).toBe(true)
      expect(isPythonFile("module.pyi")).toBe(true)
      expect(isPythonFile("script.pyw")).toBe(true)
      expect(isPythonFile("PATH/TO/SCRIPT.PY")).toBe(true)
      expect(isPythonFile("/workspace/src/app.py")).toBe(true)

      expect(isPythonFile("index.ts")).toBe(false)
      expect(isPythonFile("App.tsx")).toBe(false)
      expect(isPythonFile("script.js")).toBe(false)
      expect(isPythonFile("styles.css")).toBe(false)
      expect(isPythonFile("data.json")).toBe(false)
      expect(isPythonFile("README.md")).toBe(false)
      expect(isPythonFile("file.py.bak")).toBe(false)
      expect(isPythonFile("py")).toBe(false)
      expect(isPythonFile("")).toBe(false)
    })

    it("resolves tab size: 4 for Python files, 2 for other files", () => {
      expect(resolveTabSize("main.py")).toBe(4)
      expect(resolveTabSize("types.pyi")).toBe(4)
      expect(resolveTabSize("app.pyw")).toBe(4)
      expect(resolveTabSize("INDEX.PY")).toBe(4)

      expect(resolveTabSize("index.ts")).toBe(2)
      expect(resolveTabSize("App.tsx")).toBe(2)
      expect(resolveTabSize("server.js")).toBe(2)
      expect(resolveTabSize("styles.css")).toBe(2)
      expect(resolveTabSize("package.json")).toBe(2)
      expect(resolveTabSize("README.md")).toBe(2)
      expect(resolveTabSize("Makefile")).toBe(2)

      // getPythonTabSize alias
      expect(getPythonTabSize("script.py")).toBe(4)
      expect(getPythonTabSize("script.ts")).toBe(2)

      // custom defaultTabSize for non-python files
      expect(resolveTabSize("script.ts", 4)).toBe(4)
      expect(resolveTabSize("script.ts", 8)).toBe(8)
      expect(resolveTabSize("script.py", 2)).toBe(4) // Python always gets 4
    })
  })

  describe("stripComment & getLineIndent helper functions", () => {
    it("strips trailing comments outside quotes", () => {
      expect(stripComment("def foo():  # header").trimEnd()).toBe("def foo():")
      expect(stripComment('s = "hello # world"  # real comment').trimEnd()).toBe(
        's = "hello # world"'
      )
      expect(stripComment("s = 'hello # world'").trimEnd()).toBe(
        "s = 'hello # world'"
      )
      expect(stripComment("x = 42").trimEnd()).toBe("x = 42")
    })

    it("handles triple quoted comments and strings", () => {
      expect(stripComment('""" docstring # not comment """').trimEnd()).toBe(
        '""" docstring # not comment """'
      )
    })

    it("computes visual indent expanding spaces and tabs", () => {
      expect(getLineIndent("    foo")).toBe(4)
      expect(getLineIndent("        bar")).toBe(8)
      expect(getLineIndent("\tfoo", 4)).toBe(4)
      expect(getLineIndent("  \tfoo", 4)).toBe(4)
      expect(getLineIndent("foo")).toBe(0)
    })

    it("detects unclosed brackets across lines", () => {
      expect(countUnclosedBrackets("data = [")).toBe(1)
      expect(countUnclosedBrackets("foo(1, 2,")).toBe(1)
      expect(countUnclosedBrackets("data = [1, 2]")).toBe(0)
    })
  })

  describe("Indentation calculation after line ending with ':'", () => {
    const testCases: Array<{ label: string; header: string; baseIndent: number }> = [
      { label: "def foo():", header: "def foo():", baseIndent: 0 },
      { label: "async def bar():", header: "async def bar():", baseIndent: 0 },
      { label: "class Bar:", header: "class Bar:", baseIndent: 0 },
      { label: "if x:", header: "if x:", baseIndent: 0 },
      { label: "elif cond:", header: "elif cond:", baseIndent: 0 },
      { label: "else:", header: "else:", baseIndent: 0 },
      { label: "for i in range(10):", header: "for i in range(10):", baseIndent: 0 },
      { label: "async for item in gen():", header: "async for item in gen():", baseIndent: 0 },
      { label: "while True:", header: "while True:", baseIndent: 0 },
      { label: "try:", header: "try:", baseIndent: 0 },
      { label: "except ValueError:", header: "except ValueError:", baseIndent: 0 },
      { label: "except:", header: "except:", baseIndent: 0 },
      { label: "finally:", header: "finally:", baseIndent: 0 },
      { label: "with open('file') as f:", header: "with open('file') as f:", baseIndent: 0 },
      { label: "async with lock:", header: "async with lock:", baseIndent: 0 },
      { label: "match status:", header: "match status:", baseIndent: 0 },
      { label: "case 200:", header: "case 200:", baseIndent: 0 },
      { label: "nested if inside function", header: "    if ready:", baseIndent: 4 },
      { label: "header with inline comment", header: "def calc():  # calculate result", baseIndent: 0 }
    ]

    for (const { label, header, baseIndent } of testCases) {
      it(`indents by +4 after ${label}`, () => {
        const lines = [header, ""]
        const indent = calculatePythonIndent(lines, 1)
        expect(indent).toBe(baseIndent + 4)
      })
    }

    it("properly stacks nested indentation across multiple levels", () => {
      const doc = [
        "def outer():", // 0
        "    class Inner:", // 1
        "        if condition:", // 2
        "            for item in items:", // 3
        "                with lock:", // 4
        "" // 5
      ]
      expect(calculatePythonIndent(doc, 1)).toBe(4)
      expect(calculatePythonIndent(doc, 2)).toBe(8)
      expect(calculatePythonIndent(doc, 3)).toBe(12)
      expect(calculatePythonIndent(doc, 4)).toBe(16)
      expect(calculatePythonIndent(doc, 5)).toBe(20)
    })

    it("skips blank lines backwards to find the block header", () => {
      const doc = [
        "def foo():",
        "",
        "",
        "" // target line
      ]
      expect(calculatePythonIndent(doc, 3)).toBe(4)
    })
  })

  describe("Dedent after return, pass, break, continue, raise", () => {
    it("dedents by 4 after bare return", () => {
      const doc = [
        "def foo():",
        "    return",
        "" // target
      ]
      expect(calculatePythonIndent(doc, 2)).toBe(0)
    })

    it("dedents by 4 after return with expression", () => {
      const doc = [
        "def foo():",
        "    if x > 0:",
        "        return x * 2",
        "" // target
      ]
      expect(calculatePythonIndent(doc, 3)).toBe(4)
    })

    it("dedents by 4 after pass", () => {
      const topLevel = ["class Empty:", "    pass", ""]
      expect(calculatePythonIndent(topLevel, 2)).toBe(0)

      const nested = [
        "def handler():",
        "    if not ready:",
        "        pass",
        ""
      ]
      expect(calculatePythonIndent(nested, 3)).toBe(4)
    })

    it("dedents by 4 after break", () => {
      const doc = [
        "while True:",
        "    if done:",
        "        break",
        ""
      ]
      expect(calculatePythonIndent(doc, 3)).toBe(4)
    })

    it("dedents by 4 after continue", () => {
      const doc = [
        "for i in range(10):",
        "    if i % 2 == 0:",
        "        continue",
        ""
      ]
      expect(calculatePythonIndent(doc, 3)).toBe(4)
    })

    it("dedents by 4 after bare raise", () => {
      const doc = [
        "try:",
        "    x = 1",
        "except Exception:",
        "    raise",
        ""
      ]
      expect(calculatePythonIndent(doc, 4)).toBe(0)
    })

    it("dedents by 4 after raise with exception instance", () => {
      const doc = [
        "def validate(x):",
        "    if x < 0:",
        '        raise ValueError("Must be non-negative")',
        ""
      ]
      expect(calculatePythonIndent(doc, 3)).toBe(4)
    })

    it("dedents when line ends with inline comment", () => {
      const doc = [
        "def foo():",
        "    return 42  # finish early",
        ""
      ]
      expect(calculatePythonIndent(doc, 2)).toBe(0)
    })

    it("tests regex constants directly", () => {
      expect(DEDENT_KEYWORDS_RE.test("return")).toBe(true)
      expect(DEDENT_KEYWORDS_RE.test("pass")).toBe(true)
      expect(DEDENT_KEYWORDS_RE.test("break")).toBe(true)
      expect(DEDENT_KEYWORDS_RE.test("continue")).toBe(true)
      expect(DEDENT_KEYWORDS_RE.test("raise")).toBe(true)
      expect(CURRENT_LINE_DEDENT_RE.test("else:")).toBe(true)
      expect(CURRENT_LINE_DEDENT_RE.test("finally:")).toBe(true)
    })

    it("does not false-positive dedent identifiers containing keywords", () => {
      const doc = [
        "def test():",
        '    password = "secret"',
        ""
      ]
      // password is a normal statement, keep 4
      expect(calculatePythonIndent(doc, 2)).toBe(4)

      const doc2 = [
        "def test():",
        "    returned_val = 123",
        ""
      ]
      expect(calculatePythonIndent(doc2, 2)).toBe(4)

      const doc3 = [
        "def test():",
        "    breakpoint()",
        ""
      ]
      expect(calculatePythonIndent(doc3, 2)).toBe(4)

      const doc4 = [
        "def test():",
        "    raiser.execute()",
        ""
      ]
      expect(calculatePythonIndent(doc4, 2)).toBe(4)
    })

    it("dedents current line when typing else:, elif, except, finally, case", () => {
      const doc = [
        "if condition:",
        "    do_work()",
        "else:"
      ]
      expect(calculatePythonIndent(doc, 2)).toBe(0)

      const nestedDoc = [
        "def run():",
        "    if condition:",
        "        do_work()",
        "    elif other:"
      ]
      expect(calculatePythonIndent(nestedDoc, 3)).toBe(4)
    })
  })

  describe("CodeMirror extension integration", () => {
    it("creates an EditorState with 4-space indentUnit and tabSize", () => {
      const state = EditorState.create({
        doc: "def foo():\n",
        extensions: [pythonIndentExtension()]
      })

      expect(state.tabSize).toBe(4)
      expect(state.facet(indentUnit)).toBe("    ")
    })

    it("computes indentation through getIndentation facet after ':'", () => {
      const doc = "def foo():\n"
      const state = EditorState.create({
        doc,
        extensions: [pythonIndentExtension()]
      })

      const indent = getIndentation(state, doc.length)
      expect(indent).toBe(4)
    })

    it("computes dedentation through getIndentation after return in nested block", () => {
      const doc = "def foo():\n    if True:\n        return 1\n"
      const state = EditorState.create({
        doc,
        extensions: [pythonIndentExtension()]
      })

      const indent = getIndentation(state, doc.length)
      expect(indent).toBe(4)
    })

    it("dedents after return 1 even when paired with @codemirror/lang-python", () => {
      const doc = "def f():\n    return 1\n"
      const state = EditorState.create({
        doc,
        extensions: [python(), pythonIndentExtension({ tabSize: 4 })]
      })

      const indent = getIndentation(state, doc.length)
      expect(indent).toBe(0)
    })

    it("dedents on simulatedBreak (Enter at end of return 1)", () => {
      const doc = "def f():\n    return 1"
      const state = EditorState.create({
        doc,
        extensions: [python(), pythonIndentExtension({ tabSize: 4 })]
      })

      const indent = getIndentation(
        new IndentContext(state, { simulateBreak: doc.length }),
        doc.length
      )
      expect(indent).toBe(0)
    })

    it("exports accessory snippets for python mobile keyboard row", () => {
      expect(PYTHON_ACCESSORY_SNIPPETS).toEqual([
        { label: "def", insertText: "def ", description: "Function definition" },
        { label: "class", insertText: "class ", description: "Class definition" },
        {
          label: "main",
          insertText: 'if __name__ == "__main__":\n    ',
          description: "Main entry point block"
        },
        { label: "for", insertText: "for ", description: "For loop" },
        { label: "try", insertText: "try:\n    ", description: "Try-except block" }
      ])
    })
  })
})
