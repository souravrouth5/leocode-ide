import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MockBridge } from "../../bridge/mock"
import { createAppStores } from "../../app/stores"
import { isDirty, normalizeText } from "./model"
import { submitPrompt } from "../shell/promptActions"

describe("editor save safety (W-02/W-03/W-04)", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("keeps text typed during a write dirty", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("README.md")

    // Hold the write open, type more, then finish the write.
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = bridge.write.bind(bridge)
    bridge.write = async (path, content) => {
      await gate
      await original(path, content)
    }

    stores.editor.getState().setContent("README.md", "version A")
    const saving = stores.editor.getState().save()
    await Promise.resolve()
    stores.editor.getState().setContent("README.md", "version B")
    release()
    await saving

    const doc = stores.editor.getState().docs[0]
    expect(doc.saved).toBe("version A")
    expect(isDirty(doc)).toBe(true)
    expect(normalizeText(doc.content)).toBe("version B")
  })

  it("does not truncate an existing file when creating a new one", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    const before = await bridge.read("main.py")
    stores.shell.getState().openPrompt({
      kind: "file",
      title: "New file",
      label: "File name",
      initial: ""
    })

    await submitPrompt(stores, "main.py")

    expect(await bridge.read("main.py")).toBe(before)
    expect(stores.errors.getState().banner ?? stores.errors.getState().sheet).toBeNull()
    expect(stores.notifications.getState().queue[0].message).toBe("Already exists")
  })

  it("asks before Save As replaces an existing file", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    stores.editor.setState({
      docs: [{ path: "Untitled-1", content: "draft", saved: null, isUntitled: true }],
      activePath: "Untitled-1"
    })
    const before = await bridge.read("main.py")

    await stores.editor.getState().saveAs("main.py")

    expect(confirm).toHaveBeenCalled()
    expect(await bridge.read("main.py")).toBe(before)
    expect(stores.editor.getState().docs[0].path).toBe("Untitled-1")
  })

  it("switches to an already-open tab instead of duplicating it", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("README.md")
    stores.editor.getState().newUntitled()
    stores.editor.getState().setContent("Untitled-1", "draft")

    await stores.editor.getState().saveAs("README.md")

    expect(stores.editor.getState().docs).toHaveLength(2)
    expect(stores.editor.getState().activePath).toBe("README.md")
    expect(stores.editor.getState().docs.filter((doc) => doc.path === "README.md")).toHaveLength(1)
  })
})
