import { describe, expect, it } from "vitest"
import { MockBridge } from "../../bridge/mock"
import { createLanguageStore } from "./languageStore"

describe("languageStore", () => {
  it("initializes with empty languages and loads via refresh", async () => {
    const bridge = new MockBridge()
    const store = createLanguageStore(bridge)

    expect(store.getState().loaded).toBe(false)
    expect(store.getState().languages).toEqual([])

    await store.getState().refresh()

    expect(store.getState().loaded).toBe(true)
    expect(store.getState().loading).toBe(false)
    expect(store.getState().languages.length).toBeGreaterThan(0)
    expect(store.getState().getLanguage("python")?.id).toBe("python")
  })

  it("finds language by file extension case-insensitively", async () => {
    const bridge = new MockBridge()
    const store = createLanguageStore(bridge)
    await store.getState().refresh()

    const py = store.getState().findForFile("main.py")
    expect(py?.id).toBe("python")

    const pyUpper = store.getState().findForFile("path/to/SCRIPT.PY")
    expect(pyUpper?.id).toBe("python")

    const unknown = store.getState().findForFile("notes.txt")
    expect(unknown).toBeUndefined()

    const noExt = store.getState().findForFile("Makefile")
    expect(noExt).toBeUndefined()
  })

  it("handles empty language list cleanly (degraded mode)", async () => {
    const bridge = new MockBridge()
    bridge.setMockLanguages([])
    const store = createLanguageStore(bridge)
    await store.getState().refresh()

    expect(store.getState().loaded).toBe(true)
    expect(store.getState().languages).toEqual([])
    expect(store.getState().findForFile("main.py")).toBeUndefined()
    expect(store.getState().getLanguage("python")).toBeUndefined()
  })

  it("supports custom/fake language providers", async () => {
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
    const store = createLanguageStore(bridge)
    await store.getState().refresh()

    expect(store.getState().languages.length).toBe(1)
    const rb = store.getState().findForFile("app.rb")
    expect(rb?.id).toBe("ruby")
    expect(rb?.displayName).toBe("Ruby")
    expect(store.getState().findForFile("main.py")).toBeUndefined()
  })
})
