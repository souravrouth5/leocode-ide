import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"
import type { ProcessEvent, RunHandle } from "../../bridge"
import { PYTHON_HINT } from "./runStore"

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

describe("Python probe cache (W-13)", () => {
  it("re-probes after a miss so a fresh install is picked up", async () => {
    const bridge = new MockBridge()
    let probes = 0
    bridge.run = async (argv) => {
      if (argv[0] === "python3" && argv[1] === "--version") {
        probes += 1
        return probes === 1 ? 127 : 0
      }
      return 0
    }
    const stores = createAppStores(bridge)
    stores.editor.setState({
      docs: [{ path: "main.py", content: "print(1)\n", saved: "print(1)\n", eol: "\n" }],
      activePath: "main.py"
    })

    await stores.run.getState().runFile()
    expect(stores.run.getState().run?.hint).toBe(PYTHON_HINT)

    // The user installed Python in Runtime Manager: the next Run must try again.
    await stores.run.getState().runFile()
    expect(probes).toBe(2)
    expect(stores.run.getState().run?.hint).toBeNull()
    expect(stores.run.getState().run?.exitCode).toBe(0)
  })

  it("forgets a successful probe when invalidated", async () => {
    const bridge = new MockBridge()
    let probes = 0
    bridge.run = async (argv) => {
      if (argv[0] === "python3" && argv[1] === "--version") probes += 1
      return 0
    }
    const stores = createAppStores(bridge)
    stores.editor.setState({
      docs: [{ path: "main.py", content: "print(1)\n", saved: "print(1)\n", eol: "\n" }],
      activePath: "main.py"
    })

    await stores.run.getState().runFile()
    await stores.run.getState().runFile()
    expect(probes).toBe(1)

    stores.run.getState().invalidatePythonProbe()
    await stores.run.getState().runFile()
    expect(probes).toBe(2)
  })
})
