import { describe, expect, it } from "vitest"
import {
  isInsideWorkspace,
  toWorkspacePath,
  summarizeError,
  parseTraceback
} from "./traceback"

describe("traceback parser and error summarizer (Task 31)", () => {
  describe("workspace path filtering", () => {
    it("recognises relative paths within workspace", () => {
      expect(isInsideWorkspace("main.py")).toBe(true)
      expect(isInsideWorkspace("src/utils/calc.py")).toBe(true)
      expect(isInsideWorkspace("./app.py")).toBe(true)
    })

    it("rejects escaping relative paths", () => {
      expect(isInsideWorkspace("../sibling.py")).toBe(false)
      expect(isInsideWorkspace("foo/../../bar.py")).toBe(false)
    })

    it("rejects special Python non-file paths", () => {
      expect(isInsideWorkspace("<stdin>")).toBe(false)
      expect(isInsideWorkspace("<string>")).toBe(false)
      expect(isInsideWorkspace("<input>")).toBe(false)
    })

    it("rejects system and runtime paths", () => {
      expect(isInsideWorkspace("/system/bin/python")).toBe(false)
      expect(isInsideWorkspace("/system/lib/libpython.so")).toBe(false)
      expect(isInsideWorkspace("/data/user/0/dev.leocode/files/usr/lib/python3.11/os.py")).toBe(false)
      expect(isInsideWorkspace("/data/data/dev.leocode/files/usr/lib/python3.11/site-packages/pkg.py")).toBe(false)
      expect(isInsideWorkspace("/usr/lib/python3.11/json/decoder.py")).toBe(false)
    })

    it("handles absolute workspace roots correctly", () => {
      const root = "/data/user/0/dev.leocode/files/workspaces/project-1"

      expect(isInsideWorkspace(`${root}/main.py`, root)).toBe(true)
      expect(isInsideWorkspace(`${root}/src/math.py`, root)).toBe(true)
      expect(isInsideWorkspace("/data/user/0/dev.leocode/files/workspaces/other/main.py", root)).toBe(false)
      expect(isInsideWorkspace("/usr/lib/python3.11/os.py", root)).toBe(false)
    })

    it("converts paths to clean workspace-relative paths", () => {
      const root = "/data/user/0/dev.leocode/files/workspaces/project-1"

      expect(toWorkspacePath(`${root}/main.py`, root)).toBe("main.py")
      expect(toWorkspacePath(`${root}/src/nested/app.py`, root)).toBe("src/nested/app.py")
      expect(toWorkspacePath("./script.py")).toBe("script.py")
      expect(toWorkspacePath("script.py")).toBe("script.py")

      // External files return null
      expect(toWorkspacePath("/system/bin/sh", root)).toBeNull()
      expect(toWorkspacePath("/data/user/0/dev.leocode/files/usr/lib/python3.11/os.py", root)).toBeNull()
      expect(toWorkspacePath("../outside.py")).toBeNull()
    })
  })

  describe("error summarization", () => {
    it("summarizes SyntaxError with helpful guidance", () => {
      const summary = summarizeError("SyntaxError", "unexpected EOF while parsing")
      expect(summary.title).toBe("Syntax Error")
      expect(summary.description).toContain("invalid syntax")
      expect(summary.description).toContain("quotes")
    })

    it("summarizes ModuleNotFoundError and offers pip install", () => {
      const summary = summarizeError("ModuleNotFoundError", "No module named 'requests'")
      expect(summary.title).toContain("requests")
      expect(summary.description).toContain("requests")
      expect(summary.action).toBeDefined()
      expect(summary.action?.command).toBe("pip install requests")
      expect(summary.action?.label).toBe("pip install requests")
    })

    it("handles submodules in ModuleNotFoundError cleanly", () => {
      const summary = summarizeError("ModuleNotFoundError", "No module named 'urllib3.exceptions'")
      expect(summary.action?.command).toBe("pip install urllib3")
    })

    it("summarizes FileNotFoundError and extracts filename", () => {
      const summary = summarizeError("FileNotFoundError", "[Errno 2] No such file or directory: 'config.json'")
      expect(summary.title).toBe("File Not Found")
      expect(summary.description).toContain("config.json")
    })

    it("summarizes IndentationError", () => {
      const summary = summarizeError("IndentationError", "unexpected indent")
      expect(summary.title).toBe("Indentation Error")
      expect(summary.description).toContain("4 spaces")
    })

    it("summarizes ZeroDivisionError", () => {
      const summary = summarizeError("ZeroDivisionError", "division by zero")
      expect(summary.title).toBe("Division by Zero")
      expect(summary.description).toContain("divided by zero")
    })

    it("summarizes NameError and extracts name", () => {
      const summary = summarizeError("NameError", "name 'foo' is not defined")
      expect(summary.title).toContain("foo")
      expect(summary.description).toContain("foo")
    })
  })

  describe("traceback parsing", () => {
    it("parses multi-frame nested traceback", () => {
      const output = `
Traceback (most recent call last):
  File "main.py", line 12, in <module>
    first_step()
  File "src/first.py", line 5, in first_step
    second_step()
  File "src/second.py", line 22, in second_step
    raise ZeroDivisionError("division by zero")
ZeroDivisionError: division by zero
`
      const parsed = parseTraceback(output)

      expect(parsed.frames).toHaveLength(3)

      expect(parsed.frames[0]).toEqual({
        file: "main.py",
        line: 12,
        function: "<module>",
        code: "first_step()",
        workspacePath: "main.py",
        isWorkspaceFile: true,
        raw: 'File "main.py", line 12, in <module>'
      })

      expect(parsed.frames[1]).toEqual({
        file: "src/first.py",
        line: 5,
        function: "first_step",
        code: "second_step()",
        workspacePath: "src/first.py",
        isWorkspaceFile: true,
        raw: 'File "src/first.py", line 5, in first_step'
      })

      expect(parsed.frames[2]).toEqual({
        file: "src/second.py",
        line: 22,
        function: "second_step",
        code: 'raise ZeroDivisionError("division by zero")',
        workspacePath: "src/second.py",
        isWorkspaceFile: true,
        raw: 'File "src/second.py", line 22, in second_step'
      })

      expect(parsed.error?.type).toBe("ZeroDivisionError")
      expect(parsed.error?.title).toBe("Division by Zero")
    })

    it("filters out external stdlib frames in mixed tracebacks", () => {
      const root = "/data/user/0/dev.leocode/files/workspaces/app"
      const output = `
Traceback (most recent call last):
  File "${root}/app.py", line 14, in <module>
    load_data()
  File "${root}/src/loader.py", line 8, in load_data
    json.loads("{")
  File "/data/user/0/dev.leocode/files/usr/lib/python3.11/json/decoder.py", line 355, in decode
    raise JSONDecodeError("Expecting value", s, err.value) from None
json.decoder.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
`
      const parsed = parseTraceback(output, { workspaceRoot: root })

      expect(parsed.frames).toHaveLength(3)
      expect(parsed.frames[0].isWorkspaceFile).toBe(true)
      expect(parsed.frames[0].workspacePath).toBe("app.py")

      expect(parsed.frames[1].isWorkspaceFile).toBe(true)
      expect(parsed.frames[1].workspacePath).toBe("src/loader.py")

      expect(parsed.frames[2].isWorkspaceFile).toBe(false)
      expect(parsed.frames[2].workspacePath).toBeNull()
    })

    it("parses SyntaxError with code pointer", () => {
      const output = `
  File "syntax_bug.py", line 3
    print "hello"
          ^^^^^^^
SyntaxError: Missing parentheses in call to 'print'. Did you mean print(...)?
`
      const parsed = parseTraceback(output)

      expect(parsed.frames).toHaveLength(1)
      expect(parsed.frames[0].file).toBe("syntax_bug.py")
      expect(parsed.frames[0].line).toBe(3)
      expect(parsed.frames[0].code).toBe('print "hello"')
      expect(parsed.frames[0].isWorkspaceFile).toBe(true)

      expect(parsed.error?.type).toBe("SyntaxError")
      expect(parsed.error?.title).toBe("Syntax Error")
    })

    it("picks the final fatal exception in chained tracebacks", () => {
      const output = `
Traceback (most recent call last):
  File "test.py", line 2, in <module>
    1 / 0
ZeroDivisionError: division by zero

During handling of the above exception, another exception occurred:

Traceback (most recent call last):
  File "test.py", line 4, in <module>
    raise NameError("name 'x' is not defined")
NameError: name 'x' is not defined
`
      const parsed = parseTraceback(output)
      expect(parsed.frames).toHaveLength(2)
      expect(parsed.error?.type).toBe("NameError")
      expect(parsed.error?.title).toContain("x")
    })
  })
})
