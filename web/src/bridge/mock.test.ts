import { beforeEach, describe, expect, it } from "vitest"
import { MockBridge } from "./mock"
import { AppError } from "./types"

beforeEach(() => {
  localStorage.clear()
})

/** Store tests run against the mock, so it must fail like the host does (W-36). */
describe("MockBridge parity (W-36)", () => {
  it("throws typed AppErrors for missing and non-file paths", async () => {
    const bridge = new MockBridge()

    await expect(bridge.read("nope.txt")).rejects.toBeInstanceOf(AppError)
    await expect(bridge.read("nope.txt")).rejects.toMatchObject({ code: "E_NOT_FOUND" })
    await expect(bridge.read("src")).rejects.toMatchObject({ code: "E_NOT_DIR" })
  })

  it("reports binary files instead of returning garbage", async () => {
    const bridge = new MockBridge()
    await bridge.write("blob.bin", "a\u0000b")

    await expect(bridge.read("blob.bin")).rejects.toMatchObject({ code: "E_BINARY" })
  })

  it("enforces the 4 MB write limit", async () => {
    const bridge = new MockBridge()

    await expect(bridge.write("big.txt", "x".repeat(4 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: "E_LIMIT"
    })
  })

  it("accepts mkdir on an existing directory but never on a file", async () => {
    const bridge = new MockBridge()

    await expect(bridge.mkdir("src")).resolves.toBeUndefined()
    await expect(bridge.mkdir("README.md")).rejects.toMatchObject({ code: "E_EXISTS" })
    await expect(bridge.rename("README.md", "main.py")).rejects.toMatchObject({
      code: "E_EXISTS"
    })
  })

  it("creates missing ancestors like the host mkdirs()", async () => {
    const bridge = new MockBridge()

    await expect(bridge.mkdir("missing/child")).resolves.toBeUndefined()
    expect((await bridge.stat("missing")).kind).toBe("dir")
    expect((await bridge.stat("missing/child")).kind).toBe("dir")
  })

  it("refuses to create a directory through a file", async () => {
    const bridge = new MockBridge()

    await expect(bridge.mkdir("README.md/child")).rejects.toMatchObject({ code: "E_NOT_DIR" })
  })

  it("enforces the 4 MB read limit like the host", async () => {
    const bridge = new MockBridge()
    // `write` enforces the same cap, so seed the over-size file directly.
    bridge["nodes"].set("huge.txt", {
      kind: "file",
      content: "x".repeat(4 * 1024 * 1024 + 1),
      mtime: Date.now()
    })

    await expect(bridge.read("huge.txt")).rejects.toMatchObject({
      code: "E_LIMIT",
      message: "file is larger than 4 MB"
    })
  })

  it("reports a missing source for rename and delete", async () => {
    const bridge = new MockBridge()

    await expect(bridge.rename("nope.txt", "other.txt")).rejects.toMatchObject({
      code: "E_NOT_FOUND"
    })
    await expect(bridge.remove("nope.txt")).rejects.toMatchObject({ code: "E_NOT_FOUND" })
  })

  it("moves a folder's descendants on rename", async () => {
    const bridge = new MockBridge()
    await bridge.mkdir("old")
    await bridge.write("old/a.txt", "alpha")

    await bridge.rename("old", "new")

    expect(await bridge.read("new/a.txt")).toBe("alpha")
    await expect(bridge.read("old/a.txt")).rejects.toMatchObject({ code: "E_NOT_FOUND" })
  })

  it("reports sizes in bytes like the host", async () => {
    const bridge = new MockBridge()
    await bridge.write("unicode.txt", "é")

    const entry = (await bridge.list(".")).find((item) => item.name === "unicode.txt")
    expect(entry?.size).toBe(2)
  })

  it("handles root mode disable and enforces E_ROOT_DENIED on root openTerminal", async () => {
    const bridge = new MockBridge()
    await bridge.rootRequest()
    const statusBefore = await bridge.rootStatus()
    expect(statusBefore.enabled).toBe(true)

    let lostEvent: any = null
    bridge.onRootLost((evt) => {
      lostEvent = evt
    })

    let exited = false
    const term = await bridge.openTerminal({
      cwd: ".",
      cols: 80,
      rows: 24,
      root: true,
      onData: () => {},
      onExit: () => {
        exited = true
      }
    })
    expect(term).not.toBeNull()
    expect(term?.sessionId).toBeTruthy()

    const statusAfter = await bridge.rootDisable()
    expect(statusAfter.enabled).toBe(false)
    expect((await bridge.rootStatus()).enabled).toBe(false)

    // Root sessions exit through normal close; root.lost is NOT emitted on disable
    expect(exited).toBe(true)
    expect(lostEvent).toBeNull()

    // After disable, root openTerminal rejects with E_ROOT_DENIED
    await expect(
      bridge.openTerminal({
        cwd: ".",
        cols: 80,
        rows: 24,
        root: true,
        onData: () => {},
        onExit: () => {}
      })
    ).rejects.toMatchObject({ code: "E_ROOT_DENIED" })
  })
})
