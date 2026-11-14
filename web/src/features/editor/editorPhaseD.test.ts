import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"
import { createFindReplaceStore } from "./findReplaceStore"
import { LARGE_FILE_BYTES, isDirty } from "./model"

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("editor large-file mode (Task 15)", () => {
  it("opens files above 1 MB read-only with only the first chunk loaded", async () => {
    const bridge = new MockBridge()
    const big = "x".repeat(LARGE_FILE_BYTES + 100)
    await bridge.write("big.txt", big)
    const stores = createAppStores(bridge)

    await stores.editor.getState().openFile("big.txt")

    const doc = stores.editor.getState().docs[0]
    expect(doc.large).toBe(true)
    expect(doc.readOnly).toBe(true)
    expect(doc.truncated).toBe(true)
    expect(doc.content).toHaveLength(LARGE_FILE_BYTES)

    stores.editor.getState().setContent("big.txt", "tiny")
    expect(stores.editor.getState().docs[0].content).toHaveLength(LARGE_FILE_BYTES)
    await expect(stores.editor.getState().save()).resolves.toBe(false)
    expect(await bridge.read("big.txt")).toBe(big)
  })

  it("opens normal files with a hash baseline and editing enabled", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.editor.getState().openFile("main.py")

    const doc = stores.editor.getState().docs[0]
    expect(doc.large).toBe(false)
    expect(doc.readOnly).toBe(false)
    expect(doc.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(doc.mtime).toBeGreaterThan(0)
  })

  it("refuses Save As for a large-file buffer instead of writing a truncated copy (PD-03)", async () => {
    const bridge = new MockBridge()
    const big = "x".repeat(LARGE_FILE_BYTES + 100)
    await bridge.write("big.txt", big)
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("big.txt")
    const writeChecked = vi.spyOn(bridge, "writeChecked")

    stores.editor.getState().beginSaveAs()
    expect(stores.shell.getState().prompt).toBeNull()
    const queued = stores.notifications.getState().queue
    expect(queued[queued.length - 1].message).toContain("large-file mode")
    expect(queued[queued.length - 1].detail).toContain("truncated")

    await stores.editor.getState().saveAs("copy.txt")

    expect(writeChecked).not.toHaveBeenCalled()
    expect(stores.editor.getState().docs[0].path).toBe("big.txt")
    expect(await bridge.read("big.txt")).toBe(big)
  })

  it("saves a normal document with Save As as before (PD-03)", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")
    const original = await bridge.read("main.py")

    await stores.editor.getState().saveAs("copy.py")

    expect(await bridge.read("copy.py")).toBe(original)
    expect(stores.editor.getState().docs[0].path).toBe("copy.py")
  })
})

describe("draft autosave and recovery (Task 15)", () => {
  it("saves a dirty buffer to a draft after three idle seconds", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")

    vi.useFakeTimers()
    stores.editor.getState().setContent("main.py", "print('draft')\n")

    await vi.advanceTimersByTimeAsync(2_999)
    expect(await bridge.readDraft("main.py")).toBeNull()

    await vi.advanceTimersByTimeAsync(1)
    expect((await bridge.readDraft("main.py"))?.content).toBe("print('draft')\n")
  })

  it("drops the draft when the buffer is saved", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")
    await bridge.saveDraft("main.py", "print('draft')\n", "\n")
    stores.editor.getState().setContent("main.py", "print('saved')\n")

    await stores.editor.getState().save()

    expect(await bridge.readDraft("main.py")).toBeNull()
  })

  it("skips drafts for untitled and read-only buffers", async () => {
    const bridge = new MockBridge()
    const big = "x".repeat(LARGE_FILE_BYTES + 10)
    await bridge.write("big.txt", big)
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("big.txt")

    vi.useFakeTimers()
    stores.editor.getState().newUntitled()
    stores.editor.getState().setContent("Untitled-1.txt", "unsaved")
    stores.editor.getState().setContent("big.txt", "not loaded")
    await vi.advanceTimersByTimeAsync(3_000)

    expect(await bridge.listDrafts()).toEqual([])
  })

  it("offers a newer draft for recovery and restores it as dirty", async () => {
    const bridge = new MockBridge()
    await bridge.saveDraft("README.md", "# recovered draft\n", "\n")
    const stores = createAppStores(bridge)

    await stores.editor.getState().openFile("README.md")

    const pending = stores.editor.getState().docs[0]
    expect(pending.draft?.content).toBe("# recovered draft\n")
    expect(pending.content).toContain("Demo project")

    stores.editor.getState().restoreDraft("README.md")

    const restored = stores.editor.getState().docs[0]
    expect(restored.content).toBe("# recovered draft\n")
    expect(restored.draft).toBeNull()
    expect(isDirty(restored)).toBe(true)
    await vi.waitFor(async () => expect(await bridge.readDraft("README.md")).toBeNull())
  })

  it("discards a draft without changing the buffer", async () => {
    const bridge = new MockBridge()
    await bridge.saveDraft("README.md", "# discarded\n", "\n")
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("README.md")
    const diskContent = stores.editor.getState().docs[0].content

    stores.editor.getState().discardDraft("README.md")

    const doc = stores.editor.getState().docs[0]
    expect(doc.draft).toBeNull()
    expect(doc.content).toBe(diskContent)
    await vi.waitFor(async () => expect(await bridge.readDraft("README.md")).toBeNull())
  })
})

describe("external changes and conflicts (Task 15)", () => {
  it("flags a buffer whose file changed on disk", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")
    await bridge.write("main.py", "print('external')\n")

    await stores.editor.getState().checkExternal()

    expect(stores.editor.getState().docs[0].externalChange).toBe(true)
  })

  it("does not flag a buffer that still matches the disk", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")

    await stores.editor.getState().checkExternal()

    expect(stores.editor.getState().docs[0].externalChange).toBe(false)
  })

  it("reloads the disk version and clears the flag", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")
    await bridge.write("main.py", "print('external')\n")
    await stores.editor.getState().checkExternal()

    await stores.editor.getState().reload("main.py")

    const doc = stores.editor.getState().docs[0]
    expect(doc.content).toBe("print('external')\n")
    expect(doc.externalChange).toBe(false)
    expect(isDirty(doc)).toBe(false)
  })

  it("refuses a stale save and keeps the external text on disk", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")
    stores.editor.getState().setContent("main.py", "print('mine')\n")
    await bridge.write("main.py", "print('theirs')\n")

    await expect(stores.editor.getState().save()).resolves.toBe(false)

    expect(await bridge.read("main.py")).toBe("print('theirs')\n")
    expect(stores.editor.getState().docs[0].externalChange).toBe(true)
    expect(
      stores.notifications.getState().queue.some((notice) => notice.kind === "warning")
    ).toBe(true)
  })

  it("lets the user keep their version and overwrite the new disk text", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")
    stores.editor.getState().setContent("main.py", "print('mine')\n")
    await bridge.write("main.py", "print('theirs')\n")
    await stores.editor.getState().save()

    await stores.editor.getState().keepMine("main.py")

    let doc = stores.editor.getState().docs[0]
    expect(doc.externalChange).toBe(false)
    expect(doc.saved).toBeNull()
    expect(isDirty(doc)).toBe(true)

    await expect(stores.editor.getState().save()).resolves.toBe(true)
    expect(await bridge.read("main.py")).toBe("print('mine')\n")
    doc = stores.editor.getState().docs[0]
    expect(doc.externalChange).toBe(false)
    expect(isDirty(doc)).toBe(false)
  })

  it("recreates a file deleted behind an open tab when the user keeps their copy", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("main.py")
    const kept = stores.editor.getState().docs[0].content
    await bridge.remove("main.py")

    await stores.editor.getState().checkExternal()
    expect(stores.editor.getState().docs[0].externalChange).toBe(true)

    // No baseline exists any more: Keep mine drops it so Save recreates the file.
    await stores.editor.getState().keepMine("main.py")
    await expect(stores.editor.getState().save()).resolves.toBe(true)
    expect(await bridge.read("main.py")).toBe(kept)
  })
})

describe("find and replace commands (Task 15)", () => {
  it("dispatches the query, options and replacement to the mounted pane", () => {
    const store = createFindReplaceStore()
    const listener = vi.fn()
    window.addEventListener("leocode:editor-command", listener)

    try {
      store.getState().openSheet("print")
      store.getState().setReplacement("log")
      store.getState().setCaseSensitive(true)
      store.getState().replaceAll()

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener.mock.calls[0][0].detail).toEqual({
        action: "replaceAll",
        value: {
          query: "print",
          replacement: "log",
          caseSensitive: true,
          regexp: false
        }
      })
    } finally {
      window.removeEventListener("leocode:editor-command", listener)
    }
  })

  it("does not dispatch an empty query", () => {
    const store = createFindReplaceStore()
    const listener = vi.fn()
    window.addEventListener("leocode:editor-command", listener)

    try {
      store.getState().findNext()
      expect(listener).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener("leocode:editor-command", listener)
    }
  })
})
