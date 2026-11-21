import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"
import { submitPrompt } from "./promptActions"

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

const prompt = (stores: ReturnType<typeof createAppStores>, kind: "file" | "dir" | "rename") => {
  stores.shell.getState().openPrompt({
    kind,
    title: kind === "rename" ? "Rename" : kind === "dir" ? "New folder" : "New file",
    label: "Name",
    initial: ""
  })
}

describe("prompt validation stays inline (W-28)", () => {
  it("returns an inline error and calls nothing for a name with a slash", async () => {
    const bridge = new MockBridge()
    const write = vi.spyOn(bridge, "write")
    const stores = createAppStores(bridge)
    prompt(stores, "file")

    const error = await submitPrompt(stores, "nested/file.txt")

    expect(error).toContain("/")
    expect(write).not.toHaveBeenCalled()
    expect(stores.shell.getState().prompt).not.toBeNull()
    expect(stores.notifications.getState().queue).toHaveLength(0)
  })

  it("rejects dot-dot, control characters and over-long names", async () => {
    const stores = createAppStores(new MockBridge())
    prompt(stores, "dir")

    expect(await submitPrompt(stores, "..")).not.toBeNull()
    expect(await submitPrompt(stores, "a\u0000b")).not.toBeNull()
    expect(await submitPrompt(stores, "x".repeat(256))).toContain("at most")
  })

  it("rejects a rename to a path with a separator", async () => {
    const bridge = new MockBridge()
    const rename = vi.spyOn(bridge, "rename")
    const stores = createAppStores(bridge)
    stores.shell.getState().openPrompt({
      kind: "rename",
      title: "Rename",
      label: "New name",
      initial: "README.md",
      target: { name: "README.md", path: "README.md", kind: "file", size: 1, mtime: 0 }
    })

    expect(await submitPrompt(stores, "src/README.md")).toContain("/")
    expect(rename).not.toHaveBeenCalled()
    expect(stores.shell.getState().prompt).not.toBeNull()
  })

  it("follows a renamed folder in the explorer", async () => {
    const bridge = new MockBridge()
    await bridge.mkdir("folder")
    const stores = createAppStores(bridge)
    stores.files.getState().navigate("folder")
    await new Promise((resolve) => setTimeout(resolve, 20))
    stores.shell.getState().openPrompt({
      kind: "rename",
      title: "Rename",
      label: "New name",
      initial: "folder",
      target: { name: "folder", path: "folder", kind: "dir", size: 0, mtime: 0 }
    })

    expect(await submitPrompt(stores, "renamed")).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(stores.files.getState().cwd).toBe("renamed")
    stores.dispose()
  })

  it("creates a valid file and returns null so the prompt can close", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    prompt(stores, "file")

    expect(await submitPrompt(stores, "fresh.txt")).toBeNull()
    expect(await bridge.read("fresh.txt")).toBe("")
  })

  it("validates Save As as a path, not as a bare name", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    stores.editor.setState({
      docs: [{ path: "Untitled-1", content: "draft", saved: null, eol: "\n", isUntitled: true }],
      activePath: "Untitled-1"
    })
    stores.shell.getState().openPrompt({
      kind: "file",
      title: "Save As",
      label: "Save as",
      initial: "Untitled-1.txt"
    })

    expect(await submitPrompt(stores, "a/../b.txt")).toContain("..")
    expect(await submitPrompt(stores, "saved/draft.txt")).toBeNull()
    expect(await bridge.read("saved/draft.txt")).toBe("draft")
  })
})
