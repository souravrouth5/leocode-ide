import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MockBridge } from "../../bridge/mock"
import { createAppStores } from "../../app/stores"

describe("editor store (Task 13)", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("opens a mock file and tracks dirty state", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.editor.getState().openFile("README.md")

    const doc = stores.editor.getState().docs[0]
    expect(doc.path).toBe("README.md")
    expect(doc.content).toContain("Demo project")
    expect(stores.shell.getState().view).toBe("editor")
    expect(stores.settings.getState().settings.recentFiles[0]).toBe("README.md")

    stores.editor.getState().setContent("README.md", doc.content + "\nmore")
    await stores.editor.getState().save()
    expect(localStorage.getItem("leocode.user-settings")).toContain("README.md")
  })

  it("saves through the bridge and clears the dirty marker", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")
    stores.editor.getState().setContent("main.py", "print('changed')\n")
    await stores.editor.getState().save()

    expect(await bridge.read("main.py")).toBe("print('changed')\n")
    expect(stores.editor.getState().docs[0].saved).toBe("print('changed')\n")
  })

  it("asks for a path when an untitled buffer is saved", async () => {
    const stores = createAppStores(new MockBridge())
    stores.editor.getState().newUntitled()
    const saved = await stores.editor.getState().save()

    expect(saved).toBe(false)
    expect(stores.shell.getState().prompt?.title).toBe("Save As")
    expect(stores.shell.getState().prompt?.initial).toBe("Untitled-1.txt")
  })

  it("restores tabs from the previous session and warns about missing files", async () => {
    localStorage.setItem(
      "leocode.open-session",
      JSON.stringify({ paths: ["README.md", "gone.txt"], active: "README.md" })
    )
    const stores = createAppStores(new MockBridge())
    await stores.editor.getState().restoreSession()

    expect(stores.editor.getState().docs.map((doc) => doc.path)).toEqual(["README.md"])
    expect(stores.editor.getState().activePath).toBe("README.md")
    expect(stores.notifications.getState().queue[0].message).toContain("1 restored tab")
  })

  it("closes all tabs after confirmation", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const stores = createAppStores(new MockBridge())
    stores.editor.setState({
      docs: [
        { path: "a.txt", content: "changed", saved: "x", eol: "\n" },
        { path: "b.txt", content: "y", saved: "y", eol: "\n" }
      ],
      activePath: "a.txt"
    })

    stores.editor.getState().closeAll()
    expect(confirm).toHaveBeenCalled()
    expect(stores.editor.getState().docs).toEqual([])
    expect(stores.editor.getState().activePath).toBeNull()
  })

  it("does not create a duplicate tab when opened twice at once", async () => {
    const stores = createAppStores(new MockBridge())
    await Promise.all([
      stores.editor.getState().openFile("README.md"),
      stores.editor.getState().openFile("README.md")
    ])

    expect(stores.editor.getState().docs).toHaveLength(1)
    expect(stores.editor.getState().activePath).toBe("README.md")
  })
})
