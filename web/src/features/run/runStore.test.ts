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
      docs: [{ path: "notes.txt", content: "hi", saved: "hi", eol: "\n" }],
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

  it("degrades gracefully to no language when Python provider is removed", async () => {
    const bridge = new MockBridge()
    bridge.setMockLanguages([]) // No language providers
    const stores = createAppStores(bridge)
    await stores.language.getState().refresh()

    await stores.editor.getState().openFile("main.py")
    await stores.run.getState().runFile()

    expect(stores.run.getState().run).toBeNull()
    const notification = stores.notifications.getState().queue[0]
    expect(notification).toBeDefined()
    expect(notification.kind).toBe("warning")
    expect(notification.message).toContain("registered language provider")
  })

  it("runs a file with a custom language provider (Task 30)", async () => {
    const bridge = new MockBridge()
    bridge.setMockLanguages([
      {
        id: "ruby",
        displayName: "Ruby",
        extensions: ["rb"],
        runtimeId: null,
        supportsRepl: true,
        trustTriggers: ["script"],
        templateFiles: ["main.rb"],
        requiresRuntime: false
      }
    ])
    const stores = createAppStores(bridge)
    await stores.language.getState().refresh()

    stores.editor.setState({
      docs: [{ path: "script.rb", content: "puts 'hi'", saved: "puts 'hi'", eol: "\n" }],
      activePath: "script.rb"
    })
    await stores.run.getState().runFile()
    await settle()

    const run = stores.run.getState().run
    expect(run?.running).toBe(false)
    expect(run?.exitCode).toBe(0)
  })
})
