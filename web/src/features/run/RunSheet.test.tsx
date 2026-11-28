import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { RunSheet } from "./RunSheet"

afterEach(cleanup)

describe("RunSheet traceback frames (Task 31)", () => {
  const root = "/data/user/0/dev.leocode/files/workspaces/default"
  const pyFile = "/data/data/dev.leocode/files/workspaces/default/m1/zero.py"
  const output = [
    "Traceback (most recent call last):",
    `  File "${pyFile}", line 2, in f`,
    "    return 1 / 0",
    "ZeroDivisionError: division by zero"
  ].join("\n")

  it("renders a workspace frame once and jumps on tap", () => {
    const onJump = vi.fn()
    render(
      <RunSheet
        open={true}
        title="zero.py"
        running={false}
        exitCode={1}
        segments={[{ stream: "stderr", text: output }]}
        workspaceRoot={root}
        onJumpToFile={onJump}
        onStop={() => {}}
        onClose={() => {}}
      />
    )

    const frame = document.querySelector(".traceback-frame-line")
    expect(frame).not.toBeNull()
    // The suffix used to render twice (`line 2, in f2, in f`).
    expect(frame?.textContent?.trimEnd()).toBe(`  File "${pyFile}", line 2, in f`)
    expect(frame?.textContent?.match(/in f/g)).toHaveLength(1)

    const link = frame?.querySelector("button")
    expect(link?.getAttribute("title")).toBe("Jump to m1/zero.py:2")
    fireEvent.click(link as HTMLButtonElement)
    expect(onJump).toHaveBeenCalledWith("m1/zero.py", 2)
  })

  it("does not link a traceback frame outside the workspace", () => {
    render(
      <RunSheet
        open={true}
        title="zero.py"
        running={false}
        exitCode={1}
        segments={[
          {
            stream: "stderr",
            text: '  File "/system/lib/python3.14/os.py", line 10, in f\n'
          }
        ]}
        workspaceRoot={root}
        onStop={() => {}}
        onClose={() => {}}
      />
    )

    expect(document.querySelector(".traceback-frame-line")).toBeNull()
    expect(screen.queryByText(/Jump to/)).toBeNull()
  })
})
