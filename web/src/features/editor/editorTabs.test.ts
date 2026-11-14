import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores, type AppStores } from "../../app/stores"
import { AppError } from "../../bridge/types"
import { MockBridge } from "../../bridge/mock"
import { SESSION_KEY, isDirty, type Eol } from "./model"

const doc = (path: string, content: string, eol: Eol = "\n") => ({
  path,
  content,
  saved: content,
  eol
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const created: AppStores[] = []
const makeStores = (bridge: MockBridge = new MockBridge()) => {
  const stores = createAppStores(bridge)
  created.push(stores)
  return stores
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

afterEach(() => {
  // Leaked stores would keep writing the session 300 ms later (W-26 dispose).
  for (const stores of created.splice(0)) stores.dispose()
  localStorage.clear()
})

describe("rename and delete keep tabs coherent (W-17)", () => {
  it("rewrites every open tab under a renamed folder", () => {
    const stores = makeStores()
    stores.editor.setState({
      docs: [doc("a/x.py", "x"), doc("a/y.py", "y"), doc("b.py", "b")],
      activePath: "a/x.py"
    })

    stores.editor.getState().renamePath("a", "c")

    expect(stores.editor.getState().docs.map((item) => item.path)).toEqual([
      "c/x.py",
      "c/y.py",
      "b.py"
    ])
    expect(stores.editor.getState().activePath).toBe("c/x.py")
  })

  it("does not create a duplicate key when renaming onto an open path", () => {
    const stores = makeStores()
    stores.editor.setState({
      docs: [doc("a.txt", "a"), doc("b.txt", "b")],
      activePath: "b.txt"
    })

    stores.editor.getState().renamePath("b.txt", "a.txt")

    const paths = stores.editor.getState().docs.map((item) => item.path)
    expect(paths).toEqual(["a.txt"])
    expect(new Set(paths).size).toBe(paths.length)
    expect(stores.editor.getState().activePath).toBe("a.txt")
  })

  it("keeps another tab active when the active file is deleted", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    const bridge = new MockBridge()
    await bridge.write("a.txt", "a")
    const stores = makeStores(bridge)
    stores.editor.setState({
      docs: [doc("a.txt", "a"), doc("b.txt", "b")],
      activePath: "a.txt"
    })

    await stores.editor.getState().deleteEntry({
      name: "a.txt",
      path: "a.txt",
      kind: "file",
      size: 1,
      mtime: 0
    })

    expect(stores.editor.getState().docs.map((item) => item.path)).toEqual(["b.txt"])
    expect(stores.editor.getState().activePath).toBe("b.txt")
  })

  it("warns about unsaved changes under a folder being deleted", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    const bridge = new MockBridge()
    await bridge.mkdir("folder")
    await bridge.write("folder/a.py", "on disk")
    const stores = makeStores(bridge)
    stores.editor.setState({
      docs: [
        { path: "folder/a.py", content: "edited in the editor", saved: "on disk", eol: "\n" }
      ],
      activePath: "folder/a.py"
    })

    await stores.editor.getState().deleteEntry({
      name: "folder",
      path: "folder",
      kind: "dir",
      size: 0,
      mtime: 0
    })

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0][0])).toContain("unsaved changes")
    // Cancelling keeps the tab and the file.
    expect(stores.editor.getState().docs).toHaveLength(1)
    expect(await bridge.read("folder/a.py")).toBe("on disk")
  })
})

describe("line endings survive a save (W-18)", () => {
  it("writes CRLF back and keeps dirty tracking normalised", async () => {
    const bridge = new MockBridge()
    await bridge.write("crlf.txt", "one\r\ntwo\r\n")
    const stores = makeStores(bridge)

    await stores.editor.getState().openFile("crlf.txt")
    const opened = stores.editor.getState().docs[0]
    expect(opened.content).toBe("one\ntwo\n")
    expect(opened.eol).toBe("\r\n")

    stores.editor.getState().setContent("crlf.txt", "one\ntwo\nthree\n")
    expect(await stores.editor.getState().save()).toBe(true)

    expect(await bridge.read("crlf.txt")).toBe("one\r\ntwo\r\nthree\r\n")
    expect(stores.editor.getState().docs[0].saved).toBe("one\ntwo\nthree\n")
  })

  it("keeps CRLF for Save As", async () => {
    const bridge = new MockBridge()
    await bridge.write("crlf.txt", "a\r\nb\r\n")
    const stores = makeStores(bridge)
    await stores.editor.getState().openFile("crlf.txt")
    vi.spyOn(window, "confirm").mockReturnValue(true)

    await stores.editor.getState().saveAs("copy.txt")

    expect(await bridge.read("copy.txt")).toBe("a\r\nb\r\n")
  })
})

describe("SAF documents save through the picker (W-19)", () => {
  it("uses saveSafDocument instead of fs.write", async () => {
    const bridge = new MockBridge()
    const saveSaf = vi
      .spyOn(bridge, "saveSafDocument")
      .mockResolvedValue({ name: "saf-sample.py", uri: "content://saf/saf-sample.py" })
    const write = vi.spyOn(bridge, "write")
    const stores = makeStores(bridge)

    await stores.editor.getState().openSafDocument()
    const path = "saf://saf-sample.py"
    stores.editor.getState().setContent(path, "# edited\n")

    expect(await stores.editor.getState().save()).toBe(true)
    expect(saveSaf).toHaveBeenCalledWith("saf-sample.py", "# edited\n")
    expect(write).not.toHaveBeenCalled()
    expect(stores.editor.getState().docs[0].saved).toBe("# edited\n")
  })

  it("keeps the document dirty when the export is cancelled", async () => {
    const bridge = new MockBridge()
    vi.spyOn(bridge, "saveSafDocument").mockResolvedValue(null)
    const stores = makeStores(bridge)

    await stores.editor.getState().openSafDocument()
    stores.editor.getState().setContent("saf://saf-sample.py", "# edited\n")

    expect(await stores.editor.getState().save()).toBe(false)
    expect(isDirty(stores.editor.getState().docs[0])).toBe(true)
  })

  it("refuses Save As for a SAF document with a clear message", async () => {
    const bridge = new MockBridge()
    const stores = makeStores(bridge)
    await stores.editor.getState().openSafDocument()

    stores.editor.getState().beginSaveAs()

    expect(stores.shell.getState().prompt).toBeNull()
    const queued = stores.notifications.getState().queue
    expect(queued[queued.length - 1].message).toContain("system picker")
  })
})

describe("session restore merges and keeps transient failures (W-26)", () => {
  it("merges tabs opened while restore is in flight", async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ paths: ["README.md"], active: "README.md" })
    )
    const bridge = new MockBridge()
    let release!: () => void
    const originalRead = bridge.read.bind(bridge)
    bridge.read = async (path) => {
      if (path === "README.md") {
        await new Promise<void>((resolve) => {
          release = resolve
        })
      }
      return originalRead(path)
    }
    const stores = makeStores(bridge)

    const restoring = stores.editor.getState().restoreSession()
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    await stores.editor.getState().openFile("main.py")
    release()
    await restoring

    const paths = stores.editor.getState().docs.map((item) => item.path)
    expect(paths).toContain("main.py")
    expect(paths).toContain("README.md")
    expect(stores.editor.getState().activePath).toBe("main.py")
  })

  it("keeps a tab that failed for a transient reason in the session", async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ paths: ["stuck.txt"], active: "stuck.txt" })
    )
    const bridge = new MockBridge()
    const originalRead = bridge.read.bind(bridge)
    bridge.read = async (path) => {
      if (path === "stuck.txt") throw new AppError("E_TIMEOUT", "the host is busy")
      return originalRead(path)
    }
    const stores = makeStores(bridge)

    await stores.editor.getState().restoreSession()
    await sleep(350)

    expect(stores.editor.getState().docs).toEqual([])
    expect(stores.notifications.getState().queue.some((notice) =>
      notice.message.includes("right now")
    )).toBe(true)
    const persisted = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}")
    expect(persisted.paths).toContain("stuck.txt")
  })

  it("drops a tab only when the file is really gone", async () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ paths: ["gone.txt"], active: "gone.txt" })
    )
    const stores = makeStores()

    await stores.editor.getState().restoreSession()
    await sleep(350)

    const persisted = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}")
    expect(persisted.paths).toEqual([])
  })

  it("debounces session writes and stops after dispose", async () => {
    const stores = makeStores()
    await stores.editor.getState().restoreSession()
    stores.editor.setState({ docs: [doc("README.md", "a")], activePath: "README.md" })

    const writes: string[] = []
    vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string) => {
      writes.push(key)
    })
    const sessionWrites = () => writes.filter((key) => key === SESSION_KEY).length

    stores.editor.getState().setContent("README.md", "ab")
    stores.editor.getState().setContent("README.md", "abc")
    stores.editor.getState().setContent("README.md", "abcd")
    await sleep(100)
    expect(sessionWrites()).toBe(0)
    await sleep(300)
    expect(sessionWrites()).toBe(1)

    stores.dispose()
    stores.editor.getState().setContent("README.md", "after dispose")
    await sleep(350)
    expect(sessionWrites()).toBe(1)
  })
})
