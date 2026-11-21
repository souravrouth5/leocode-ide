import { describe, expect, it } from "vitest"
import {
  MAX_TERMINAL_TITLE,
  clearSessionId,
  readSessionId,
  sanitizeTerminalTitle,
  writeSessionId
} from "./session"

describe("terminal session helpers (Task 13)", () => {
  it("strips OSC/CSI titles and control characters", () => {
    // OSC handlers receive the payload; escape wrappers are stripped if present.
    expect(sanitizeTerminalTitle("bash\u0007")).toBe("bash")
    expect(sanitizeTerminalTitle("\u001b[31mred\u001b[0m")).toBe("red")
    expect(sanitizeTerminalTitle("\u001b]0;title\u0007bash")).toBe("bash")
    expect(sanitizeTerminalTitle("  spaced\u0000  out  ")).toBe("spaced out")
    expect(sanitizeTerminalTitle("a".repeat(MAX_TERMINAL_TITLE + 20))).toHaveLength(
      MAX_TERMINAL_TITLE
    )
  })

  it("round-trips the session id and clears it", () => {
    writeSessionId("abc-123")
    expect(readSessionId()).toBe("abc-123")
    clearSessionId()
    expect(readSessionId()).toBeNull()
  })
})
