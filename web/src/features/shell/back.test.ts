import { beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import { AppError } from "../../bridge/types"
import { MockBridge } from "../../bridge/mock"
import { handleBack } from "./back"

beforeEach(() => {
  localStorage.clear()
})

describe("Android back button (W-12)", () => {
  it("walks onboarding back and never dismisses it from the first screen", () => {
    const stores = createAppStores(new MockBridge())
    stores.shell.getState().openOnboarding()
    stores.shell.getState().setOnboardingStep(1)

    expect(handleBack(stores)).toBe(true)
    expect(stores.shell.getState().onboardingStep).toBe(0)
    expect(stores.shell.getState().onboardingOpen).toBe(true)

    expect(handleBack(stores)).toBe(true)
    expect(stores.shell.getState().onboardingOpen).toBe(true)
  })

  it("closes the error sheet before anything else", () => {
    const stores = createAppStores(new MockBridge())
    stores.errors.getState().report(new AppError("E_INTERNAL", "boom"))
    stores.shell.getState().setSidebarOpen(true)

    expect(handleBack(stores)).toBe(true)
    expect(stores.errors.getState().sheet).toBeNull()
    expect(stores.shell.getState().sidebarOpen).toBe(true)
  })

  it("closes the banner next", () => {
    const stores = createAppStores(new MockBridge())
    stores.errors.getState().report(new AppError("E_TIMEOUT", "slow"))
    stores.shell.getState().setSidebarOpen(true)

    expect(stores.errors.getState().banner).not.toBeNull()
    expect(handleBack(stores)).toBe(true)
    expect(stores.errors.getState().banner).toBeNull()
    expect(stores.shell.getState().sidebarOpen).toBe(true)
  })

  it("closes a local action sheet before the drawer", () => {
    const stores = createAppStores(new MockBridge())
    const closeSheet = vi.fn()
    stores.shell.getState().registerSheet({ id: "filetree-actions", close: closeSheet })
    stores.shell.getState().setSidebarOpen(true)

    expect(handleBack(stores)).toBe(true)
    expect(closeSheet).toHaveBeenCalledTimes(1)
    expect(stores.shell.getState().sidebarOpen).toBe(true)

    expect(handleBack(stores)).toBe(true)
    expect(stores.shell.getState().sidebarOpen).toBe(false)
  })

  it("hides a running run sheet without cancelling the process", async () => {
    const bridge = new MockBridge()
    const cancel = vi.fn()
    bridge.run = async (_argv, _cwd, _onEvent, onStart) => {
      onStart?.({ cancel })
      return new Promise<number>(() => {})
    }
    const stores = createAppStores(bridge)
    stores.editor.setState({
      docs: [{ path: "run.sh", content: "echo hi", saved: "echo hi", eol: "\n" }],
      activePath: "run.sh"
    })

    void stores.run.getState().runFile()
    await vi.waitFor(() => expect(stores.run.getState().run?.running).toBe(true))
    expect(stores.run.getState().sheetOpen).toBe(true)

    expect(handleBack(stores)).toBe(true)
    expect(stores.run.getState().sheetOpen).toBe(false)
    expect(stores.run.getState().run?.running).toBe(true)
    expect(cancel).not.toHaveBeenCalled()

    // The sheet can be shown again, and Stop is the separate cancel path.
    stores.run.getState().show()
    expect(stores.run.getState().sheetOpen).toBe(true)
    stores.run.getState().stop()
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it("closes the prompt and settings after the run sheet", () => {
    const stores = createAppStores(new MockBridge())
    stores.shell.getState().openPrompt({
      kind: "file",
      title: "New file",
      label: "File name",
      initial: ""
    })
    stores.shell.getState().setSettingsOpen(true)

    expect(handleBack(stores)).toBe(true)
    expect(stores.shell.getState().prompt).toBeNull()
    expect(stores.shell.getState().settingsOpen).toBe(false)
  })

  it("returns to the editor view last, then lets Android leave", () => {
    const stores = createAppStores(new MockBridge())
    stores.shell.getState().go("terminal")

    expect(handleBack(stores)).toBe(true)
    expect(stores.shell.getState().view).toBe("editor")
    expect(handleBack(stores)).toBe(false)
  })
})
