import { describe, expect, it } from "vitest"
import {
  MAX_TERMINAL_TITLE,
  handleOsc52,
  hasOsc52,
  sanitizeTerminalTitle,
  stripOsc52
} from "./terminalSanitize"

describe("terminal title and escape sanitization (Task 29)", () => {
  it("preserves clean titles and trims whitespace", () => {
    expect(sanitizeTerminalTitle("bash")).toBe("bash")
    expect(sanitizeTerminalTitle("  python3 main.py  ")).toBe("python3 main.py")
    expect(sanitizeTerminalTitle("")).toBe("")
    expect(sanitizeTerminalTitle("   ")).toBe("")
  })

  it("strips CSI color and cursor sequences", () => {
    expect(sanitizeTerminalTitle("\u001b[31mred\u001b[0m text")).toBe("red text")
    expect(sanitizeTerminalTitle("\u001b[1;32;40mbold green\u001b[0m")).toBe("bold green")
    expect(sanitizeTerminalTitle("\u001b[2J\u001b[Hclear screen")).toBe("clear screen")
    expect(sanitizeTerminalTitle("\u001b[?25hcursor")).toBe("cursor")
  })

  it("strips embedded OSC window title and hyperlink sequences", () => {
    // OSC 0 and OSC 2 window titles
    expect(sanitizeTerminalTitle("\u001b]0;fake title\u0007real title")).toBe("real title")
    expect(sanitizeTerminalTitle("\u001b]2;nested\u001b\\actual")).toBe("actual")
    // OSC 8 hyperlinks
    expect(
      sanitizeTerminalTitle("\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007")
    ).toBe("link")
  })

  it("strips C0 and C1 control characters (0x00-0x1F, 0x7F-0x9F)", () => {
    // Null byte, bell, backspace, carriage return, tabs, delete
    const withControls = "root\u0000\u0007\u0008@\u001fhost\u007f"
    expect(sanitizeTerminalTitle(withControls)).toBe("root@host")

    // C1 control characters (0x80 - 0x9F)
    const withC1 = "prompt\u0080\u0090\u009fend"
    expect(sanitizeTerminalTitle(withC1)).toBe("promptend")
  })

  it("collapses multiple spaces, tabs, and newlines into single spaces", () => {
    expect(sanitizeTerminalTitle("foo \t\r\n bar   baz")).toBe("foo bar baz")
  })

  it("clamps maximum title length to 80 characters", () => {
    const longTitle = "a".repeat(120)
    const sanitized = sanitizeTerminalTitle(longTitle)
    expect(sanitized).toHaveLength(MAX_TERMINAL_TITLE)
    expect(sanitized).toBe("a".repeat(80))

    const exact80 = "b".repeat(80)
    expect(sanitizeTerminalTitle(exact80)).toBe(exact80)
  })

  it("preserves multibyte unicode and emojis", () => {
    expect(sanitizeTerminalTitle("🚀 LeoCode — 终端")).toBe("🚀 LeoCode — 终端")
    expect(sanitizeTerminalTitle("\u001b[33m⚡\u001b[0m Fast")).toBe("⚡ Fast")
  })
})

describe("OSC 52 clipboard hijacking protection (Task 29)", () => {
  const osc52Bel = "\u001b]52;c;SGVsbG8gV29ybGQ=\u0007"
  const osc52St = "\u001b]52;c;dGVzdA==\u001b\\"
  const osc52Query = "\u001b]52;c;?\u0007"

  it("detects OSC 52 clipboard sequences via hasOsc52", () => {
    expect(hasOsc52(osc52Bel)).toBe(true)
    expect(hasOsc52(osc52St)).toBe(true)
    expect(hasOsc52(osc52Query)).toBe(true)
    expect(hasOsc52("prefix " + osc52Bel + " suffix")).toBe(true)

    // Normal text or OSC 0 title should return false
    expect(hasOsc52("normal output")).toBe(false)
    expect(hasOsc52("\u001b]0;Title\u0007")).toBe(false)
    expect(hasOsc52("\u001b[32mgreen text\u001b[0m")).toBe(false)
  })

  it("strips OSC 52 sequences while preserving surrounding text", () => {
    const mixed = `output 1\n${osc52Bel}output 2\n${osc52St}done`
    expect(stripOsc52(mixed)).toBe("output 1\noutput 2\ndone")
  })

  it("sanitizes titles containing malicious OSC 52 injections", () => {
    const maliciousTitle = `My Term ${osc52Bel}`
    expect(sanitizeTerminalTitle(maliciousTitle)).toBe("My Term")
  })

  it("handleOsc52 swallows clipboard access by returning true", () => {
    // xterm.js registerOscHandler expects boolean true to signal sequence was handled/consumed
    expect(handleOsc52("c;SGVsbG8=")).toBe(true)
    expect(handleOsc52("c;?")).toBe(true)
    expect(handleOsc52("")).toBe(true)
  })
})
