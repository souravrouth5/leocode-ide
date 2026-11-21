import { describe, expect, it } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"
import type { PythonStatus } from "../../bridge"

const status = (overrides: Partial<PythonStatus> = {}): PythonStatus => ({
  runtimeInstalled: true,
  runtimePython: "/data/usr/bin/python3",
  venvExists: false,
  venvPath: "/data/project/.venv",
  venvPython: null,
  requirementsExists: false,
  requirementsPath: null,
  requirementsHash: null,
  requirementsInstalled: false,
  aliasesReady: true,
  ...overrides
})

describe("python store (Task 26)", () => {
  it("asks for trust before creating the project venv", async () => {
    const bridge = new MockBridge()
    let current = status()
    let created = 0
    bridge.pythonStatus = async () => current
    bridge.trustCheck = async (request) => ({
      trusted: false,
      action: request.action ?? "venv",
      fingerprint: "sha256:test"
    })
    bridge.trustGrant = async (request) => ({
      trusted: true,
      action: request.action ?? "venv",
      fingerprint: "sha256:test"
    })
    bridge.pythonCreateVenv = async () => {
      created += 1
      current = status({ venvExists: true, venvPython: "/data/project/.venv/bin/python" })
      return { created: true, status: current }
    }
    const stores = createAppStores(bridge)
    stores.dialogs.setState({ confirm: async () => true })

    await stores.python.getState().refresh()
    expect(await stores.python.getState().ensureVenv()).toBe(true)

    expect(created).toBe(1)
    expect(stores.python.getState().status?.venvExists).toBe(true)
  })

  it("does not create anything when trust is declined", async () => {
    const bridge = new MockBridge()
    bridge.pythonStatus = async () => status()
    bridge.trustCheck = async (request) => ({
      trusted: false,
      action: request.action ?? "venv",
      fingerprint: "sha256:test"
    })
    let created = 0
    bridge.pythonCreateVenv = async () => {
      created += 1
      return { created: false, status: status() }
    }
    const stores = createAppStores(bridge)
    stores.dialogs.setState({ confirm: async () => false })

    await stores.python.getState().refresh()
    expect(await stores.python.getState().ensureVenv()).toBe(false)
    expect(created).toBe(0)
  })

  it("streams pip output and refreshes the requirements state", async () => {
    const bridge = new MockBridge()
    let current = status({
      venvExists: true,
      venvPython: "/data/project/.venv/bin/python",
      requirementsExists: true,
      requirementsPath: "/data/project/requirements.txt",
      requirementsHash: "sha256:req"
    })
    bridge.pythonStatus = async () => current
    bridge.trustCheck = async (request) => ({
      trusted: true,
      action: request.action ?? "pip",
      fingerprint: "sha256:req"
    })
    bridge.pythonInstallRequirements = async (_request, onLine) => {
      onLine("Collecting requests")
      onLine("Successfully installed requests")
      current = { ...current, requirementsInstalled: true }
      return {
        ok: true,
        exitCode: 0,
        output: "Collecting requests\nSuccessfully installed requests\n"
      }
    }
    const stores = createAppStores(bridge)

    await stores.python.getState().refresh()
    expect(await stores.python.getState().installRequirements()).toBe(true)

    expect(stores.python.getState().installLog).toEqual([
      "Collecting requests",
      "Successfully installed requests"
    ])
    expect(stores.python.getState().status?.requirementsInstalled).toBe(true)
  })

  it("keeps a failed install visible without claiming success", async () => {
    const bridge = new MockBridge()
    bridge.pythonStatus = async () =>
      status({
        venvExists: true,
        venvPython: "/data/project/.venv/bin/python",
        requirementsExists: true,
        requirementsPath: "/data/project/requirements.txt",
        requirementsHash: "sha256:req"
      })
    bridge.trustCheck = async (request) => ({
      trusted: true,
      action: request.action ?? "pip",
      fingerprint: "sha256:req"
    })
    bridge.pythonInstallRequirements = async (_request, onLine) => {
      onLine("ERROR: No matching distribution found")
      return {
        ok: false,
        exitCode: 1,
        output: "ERROR: No matching distribution found\n"
      }
    }
    const stores = createAppStores(bridge)

    await stores.python.getState().refresh()
    expect(await stores.python.getState().installRequirements()).toBe(false)
    expect(stores.notifications.getState().queue[0].kind).toBe("error")
  })
})
