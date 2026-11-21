import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"
import type { ProcessEvent, PythonStatus, RunHandle } from "../../bridge"

interface PendingRun {
  onEvent: (event: ProcessEvent) => void
  onStart: (handle: RunHandle) => void
  resolve: (code: number) => void
}

const scriptDoc = (path = "run.sh") => ({
  path,
  content: "echo hi\n",
  saved: "echo hi\n",
  eol: "\n" as const
})

beforeEach(() => {
  localStorage.clear()
})

describe("run identity (W-14)", () => {
  it("drops output and exit from a run that was already closed", async () => {
    const bridge = new MockBridge()
    const pending: PendingRun[] = []
    bridge.run = (_argv, _cwd, onEvent, onStart) =>
      new Promise<number>((resolve) => {
        pending.push({ onEvent, onStart: onStart!, resolve })
      })

    const stores = createAppStores(bridge)
    stores.editor.setState({ docs: [scriptDoc()], activePath: "run.sh" })

    const first = stores.run.getState().runFile()
    await vi.waitFor(() => expect(pending).toHaveLength(1))
    const cancelFirst = vi.fn()
    pending[0].onStart({ cancel: cancelFirst })

    stores.run.getState().close()
    expect(cancelFirst).toHaveBeenCalledTimes(1)

    const second = stores.run.getState().runFile()
    await vi.waitFor(() => expect(pending).toHaveLength(2))
    const cancelSecond = vi.fn()
    pending[1].onStart({ cancel: cancelSecond })

    // Late output and exit from the cancelled run must not touch the new one.
    pending[0].onEvent({ stream: "stdout", data: "stale output\n" })
    pending[0].resolve(7)
    await first
    await new Promise((resolve) => setTimeout(resolve, 20))

    const run = stores.run.getState().run
    expect(run?.running).toBe(true)
    expect(run?.exitCode).toBeNull()
    expect(run?.segments.map((segment) => segment.text).join("")).not.toContain("stale")

    // The new run's handle is still installed, so Stop reaches the right process.
    stores.run.getState().stop()
    expect(cancelSecond).toHaveBeenCalledTimes(1)
    expect(cancelFirst).toHaveBeenCalledTimes(1)
    pending[1].resolve(0)
    await second
  })

  it("starts one process for two quick taps", async () => {
    const bridge = new MockBridge()
    let spawns = 0
    bridge.run = async (argv) => {
      if (argv[1] === "--version") return 0
      spawns += 1
      return 0
    }
    const stores = createAppStores(bridge)
    stores.editor.setState({ docs: [scriptDoc()], activePath: "run.sh" })

    await Promise.all([stores.run.getState().runFile(), stores.run.getState().runFile()])

    expect(spawns).toBe(1)
    expect(stores.run.getState().starting).toBe(false)
  })

  it("reports starting until the spawn happens", async () => {
    const bridge = new MockBridge()
    let releaseWrite!: () => void
    const originalWrite = bridge.write.bind(bridge)
    bridge.write = async (path, content) => {
      await new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      await originalWrite(path, content)
    }
    const stores = createAppStores(bridge)
    stores.editor.setState({
      docs: [{ ...scriptDoc(), content: "echo changed\n" }],
      activePath: "run.sh"
    })

    const running = stores.run.getState().runFile()
    await vi.waitFor(() => expect(releaseWrite).toBeTypeOf("function"))
    // A second tap while the buffer is being saved must be a no-op (W-14).
    expect(stores.run.getState().starting).toBe(true)
    void stores.run.getState().runFile()

    releaseWrite()
    await running
    expect(stores.run.getState().starting).toBe(false)
  })
})

describe("Python project run (Task 26)", () => {
  const pythonDoc = () => ({
    path: "main.py",
    content: "print(1)\n",
    saved: "print(1)\n",
    eol: "\n" as const
  })

  const status = (overrides: Partial<PythonStatus> = {}): PythonStatus => ({
    runtimeInstalled: true,
    runtimePython: "/data/usr/bin/python3",
    venvExists: true,
    venvPath: "/data/project/.venv",
    venvPython: "/data/project/.venv/bin/python",
    requirementsExists: false,
    requirementsPath: null,
    requirementsHash: null,
    requirementsInstalled: false,
    aliasesReady: true,
    ...overrides
  })

  it("runs with the project venv and its environment", async () => {
    const bridge = new MockBridge()
    bridge.pythonStatus = async () => status()
    let argvSeen: string[] = []
    let envSeen: Record<string, string> | undefined
    bridge.run = async (argv, _cwd, _onEvent, _onStart, options) => {
      argvSeen = argv
      envSeen = options?.env
      return 0
    }
    const stores = createAppStores(bridge)
    stores.editor.setState({ docs: [pythonDoc()], activePath: "main.py" })

    await stores.run.getState().runFile()

    expect(argvSeen[0]).toBe("/data/project/.venv/bin/python")
    expect(envSeen?.VIRTUAL_ENV).toBe("/data/project/.venv")
    expect(envSeen?.PATH).toContain("/data/project/.venv/bin")
    expect(stores.run.getState().run?.exitCode).toBe(0)
  })

  it("does not spawn when the user declines trust", async () => {
    const bridge = new MockBridge()
    bridge.pythonStatus = async () => status()
    bridge.trustCheck = async (request) => ({
      trusted: false,
      action: request.action ?? "script",
      fingerprint: "sha256:test"
    })
    const run = vi.fn(async () => 0)
    bridge.run = run
    const stores = createAppStores(bridge)
    stores.dialogs.setState({ confirm: async () => false })
    stores.editor.setState({ docs: [pythonDoc()], activePath: "main.py" })

    await stores.run.getState().runFile()

    expect(run).not.toHaveBeenCalled()
    expect(stores.run.getState().run?.hint).toContain("not trusted")
  })

  it("installs missing requirements before the first run", async () => {
    const bridge = new MockBridge()
    let installed = false
    bridge.pythonStatus = async () =>
      status({
        requirementsExists: true,
        requirementsPath: "/data/project/requirements.txt",
        requirementsHash: "sha256:req",
        requirementsInstalled: installed
      })
    let installs = 0
    bridge.pythonInstallRequirements = async (_request, onLine) => {
      installs += 1
      installed = true
      onLine("Successfully installed requests")
      return { ok: true, exitCode: 0, output: "Successfully installed requests\n" }
    }
    const run = vi.fn(async () => 0)
    bridge.run = run
    const stores = createAppStores(bridge)
    stores.dialogs.setState({ confirm: async () => true })
    stores.editor.setState({ docs: [pythonDoc()], activePath: "main.py" })

    await stores.run.getState().runFile()

    expect(installs).toBe(1)
    expect(run).toHaveBeenCalled()
    expect(stores.python.getState().status?.requirementsInstalled).toBe(true)
  })

  it("refreshes the cached status when a runtime is installed", async () => {
    const bridge = new MockBridge()
    let probes = 0
    bridge.pythonStatus = async () => {
      probes += 1
      return status()
    }
    bridge.run = async () => 0
    const stores = createAppStores(bridge)
    stores.editor.setState({ docs: [pythonDoc()], activePath: "main.py" })

    await stores.run.getState().runFile()
    expect(probes).toBe(1)

    stores.run.getState().invalidatePythonProbe()
    await vi.waitFor(() => expect(probes).toBe(2))
  })
})
