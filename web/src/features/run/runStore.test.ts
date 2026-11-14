import { describe, expect, it } from "vitest"
import { MockBridge } from "../../bridge/mock"
import { createAppStores } from "../../app/stores"

const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

describe("run store (Task 13)", () => {
  it("runs a mock Python file and collects its output", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.editor.getState().openFile("main.py")

    await stores.run.getState().runFile()
    await settle()

    const run = stores.run.getState().run
    expect(run?.running).toBe(false)
    expect(run?.exitCode).toBe(0)
    expect(run?.segments.map((segment) => segment.text).join("")).toContain("Hello, LeoCode!")
  })

  it("refuses a file type it cannot run and explains why", async () => {
    const stores = createAppStores(new MockBridge())
    stores.editor.setState({
      docs: [{ path: "notes.txt", content: "hi", saved: "hi" }],
      activePath: "notes.txt"
    })

    await stores.run.getState().runFile()

    expect(stores.run.getState().run).toBeNull()
    expect(stores.notifications.getState().queue[0].message).toContain("can only run")
  })

  it("saves a dirty buffer before running it", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.editor.getState().openFile("src/app.py")
    stores.editor.getState().setContent("src/app.py", "print('edited')\n")

    await stores.run.getState().runFile()
    await settle()

    expect(await bridge.read("src/app.py")).toBe("print('edited')\n")
    expect(stores.run.getState().run?.running).toBe(false)
  })

  it("stops the current run and closes the sheet", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.editor.getState().openFile("main.py")
    stores.run.setState({
      run: { title: "main.py", running: true, exitCode: null, segments: [], hint: null }
    })

    stores.run.getState().close()
    expect(stores.run.getState().run).toBeNull()
  })
})
