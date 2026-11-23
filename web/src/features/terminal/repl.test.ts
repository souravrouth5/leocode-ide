import React from "react"
import { describe, expect, it, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import type { PythonStatus } from "../../bridge"
import { MockBridge } from "../../bridge/mock"
import {
  getPythonReplSpec,
  launchReplSession,
  resolveReplSpec
} from "./repl"
import { TerminalPane } from "./TerminalPane"

const createStatus = (overrides: Partial<PythonStatus> = {}): PythonStatus => ({
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

describe("Python REPL integration (Task 32)", () => {
  describe("getPythonReplSpec", () => {
    it("configures REPL with active project venv and environment", () => {
      const status = createStatus({
        venvExists: true,
        venvPython: "/data/project/.venv/bin/python3",
        venvPath: "/data/project/.venv"
      })

      const spec = getPythonReplSpec(status)
      expect(spec.mode).toBe("venv")
      expect(spec.executable).toBe("/data/project/.venv/bin/python3")
      expect(spec.title).toBe("Python REPL (.venv)")
      expect(spec.env.VIRTUAL_ENV).toBe("/data/project/.venv")
      expect(spec.env.PATH).toContain("/data/project/.venv/bin")
      expect(spec.commandString).toContain("export VIRTUAL_ENV=\"/data/project/.venv\"")
      expect(spec.commandString).toContain('"/data/project/.venv/bin/python3" -i')
    })

    it("configures REPL with runtime Python when no venv exists", () => {
      const status = createStatus({
        runtimeInstalled: true,
        runtimePython: "/data/usr/bin/python3",
        venvExists: false
      })

      const spec = getPythonReplSpec(status)
      expect(spec.mode).toBe("runtime")
      expect(spec.executable).toBe("/data/usr/bin/python3")
      expect(spec.title).toBe("Python REPL (runtime)")
      expect(spec.commandString).toBe('"/data/usr/bin/python3" -i\n')
    })

    it("falls back to system python3 when no runtime or venv is installed", () => {
      const status = createStatus({
        runtimeInstalled: false,
        runtimePython: null,
        venvExists: false
      })

      const spec = getPythonReplSpec(status)
      expect(spec.mode).toBe("system")
      expect(spec.executable).toBe("python3")
      expect(spec.title).toBe("Python REPL")
      expect(spec.commandString).toBe("python3 -i\n")
    })
  })

  describe("resolveReplSpec", () => {
    it("uses cached status if provided", async () => {
      const status = createStatus({
        venvExists: true,
        venvPython: "/custom/venv/bin/python3",
        venvPath: "/custom/venv"
      })
      const spec = await resolveReplSpec(null, status)
      expect(spec.mode).toBe("venv")
      expect(spec.executable).toBe("/custom/venv/bin/python3")
    })

    it("queries bridge.pythonStatus when status is not cached", async () => {
      const bridge = new MockBridge()
      bridge.pythonStatus = async () =>
        createStatus({
          venvExists: true,
          venvPython: "/queried/venv/bin/python3",
          venvPath: "/queried/venv"
        })

      const spec = await resolveReplSpec(bridge, null)
      expect(spec.mode).toBe("venv")
      expect(spec.executable).toBe("/queried/venv/bin/python3")
    })
  })

  describe("launchReplSession", () => {
    it("writes encoded command string to terminal handle", () => {
      const written: Uint8Array[] = []
      const fakeHandle = {
        write: (bytes: Uint8Array) => {
          written.push(bytes)
        }
      }

      const spec = getPythonReplSpec(createStatus())
      const launched = launchReplSession(fakeHandle, spec)

      expect(launched).toBe(true)
      expect(written.length).toBe(1)
      const decoded = new TextDecoder().decode(written[0])
      expect(decoded).toBe(spec.commandString)
    })

    it("returns false if handle is null", () => {
      const spec = getPythonReplSpec(createStatus())
      expect(launchReplSession(null, spec)).toBe(false)
    })
  })

  describe("TerminalPane REPL UI", () => {
    it("renders Python REPL action button and triggers onLaunchRepl", async () => {
      const bridge = new MockBridge()
      const venvStatus = createStatus({
        venvExists: true,
        venvPython: "/data/project/.venv/bin/python3",
        venvPath: "/data/project/.venv"
      })
      bridge.pythonStatus = async () => venvStatus

      const onLaunchRepl = vi.fn()

      render(
        React.createElement(TerminalPane, {
          bridge,
          cwd: "/data/project",
          active: true,
          dark: true,
          pythonStatus: venvStatus,
          onLaunchRepl
        })
      )

      const replBtn = screen.getByRole("button", { name: /Python REPL/i })
      expect(replBtn).toBeDefined()

      fireEvent.click(replBtn)

      await waitFor(() => {
        expect(onLaunchRepl).toHaveBeenCalledTimes(1)
      })

      const launchedSpec = onLaunchRepl.mock.calls[0][0]
      expect(launchedSpec.mode).toBe("venv")
      expect(launchedSpec.executable).toBe("/data/project/.venv/bin/python3")
    })
  })
})
