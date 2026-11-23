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

  describe("Task 31: Python run experience, traceback parsing and duration", () => {
    it("tracks start time and elapsed duration", async () => {
      const stores = createAppStores(new MockBridge())
      await stores.editor.getState().openFile("main.py")

      await stores.run.getState().runFile()
      await settle()

      const run = stores.run.getState().run
      expect(run?.running).toBe(false)
      expect(run?.startedAt).toBeTypeOf("number")
      expect(run?.durationMs).toBeTypeOf("number")
      expect(run!.durationMs!).toBeGreaterThanOrEqual(0)
    })

    it("parses traceback and extracts error summary on exception", async () => {
      const bridge = new MockBridge()
      bridge.run = async (_argv, _cwd, onEvent) => {
        onEvent({
          stream: "stderr",
          data: `Traceback (most recent call last):
  File "main.py", line 10, in <module>
    calc()
  File "utils.py", line 5, in calc
    1 / 0
ZeroDivisionError: division by zero
`
        })
        return 1
      }
      const stores = createAppStores(bridge)
      await stores.editor.getState().openFile("main.py")

      await stores.run.getState().runFile()
      await settle()

      const run = stores.run.getState().run
      expect(run?.running).toBe(false)
      expect(run?.exitCode).toBe(1)
      expect(run?.traceback?.frames).toHaveLength(2)
      expect(run?.traceback?.frames[0].file).toBe("main.py")
      expect(run?.traceback?.frames[1].file).toBe("utils.py")
      expect(run?.errorSummary).toBeDefined()
      expect(run?.errorSummary?.type).toBe("ZeroDivisionError")
      expect(run?.errorSummary?.title).toBe("Division by Zero")
    })

    it("identifies ModuleNotFoundError and suggests pip install", async () => {
      const bridge = new MockBridge()
      bridge.run = async (_argv, _cwd, onEvent) => {
        onEvent({
          stream: "stderr",
          data: `Traceback (most recent call last):
  File "main.py", line 2, in <module>
    import httpx
ModuleNotFoundError: No module named 'httpx'
`
        })
        return 1
      }
      const stores = createAppStores(bridge)
      await stores.editor.getState().openFile("main.py")

      await stores.run.getState().runFile()
      await settle()

      const run = stores.run.getState().run
      expect(run?.errorSummary?.type).toBe("ModuleNotFoundError")
      expect(run?.errorSummary?.title).toContain("httpx")
      expect(run?.errorSummary?.action?.command).toBe("pip install httpx")
    })

    it("supports sending stdin input while running", async () => {
      const stores = createAppStores(new MockBridge())
      stores.run.setState({
        run: {
          title: "script.py",
          running: true,
          exitCode: null,
          segments: [{ stream: "stdout", text: "Enter name: " }],
          hint: null,
          startedAt: Date.now(),
          durationMs: null
        }
      })

      stores.run.getState().sendInput("Alice")

      const run = stores.run.getState().run
      const allText = run?.segments.map((s) => s.text).join("")
      expect(allText).toContain("Alice\n")
    })

    it("ignores sendInput when run is not running", () => {
      const stores = createAppStores(new MockBridge())
      stores.run.setState({
        run: {
          title: "script.py",
          running: false,
          exitCode: 0,
          segments: [],
          hint: null
        }
      })

      stores.run.getState().sendInput("ignored")
      expect(stores.run.getState().run?.segments).toHaveLength(0)
    })

    it("jumps to file and line via editor store", async () => {
      const stores = createAppStores(new MockBridge())
      await stores.run.getState().jumpToFile("main.py", 8)

      expect(stores.editor.getState().activePath).toBe("main.py")
    })
  })
})
