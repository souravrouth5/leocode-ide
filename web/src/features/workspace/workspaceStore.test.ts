import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const projectId = (stores: ReturnType<typeof createAppStores>, name: string): string => {
  const record = stores.workspace.getState().workspaces.find((item) => item.name === name)
  if (!record) throw new Error(`no workspace named ${name}`)
  return record.id
}

describe("workspace store (Task 14)", () => {
  it("mirrors the host registry and its active workspace", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.workspace.getState().load()

    expect(stores.workspace.getState().loading).toBe(false)
    expect(stores.workspace.getState().activeId).toBe("default")
    expect(stores.workspace.getState().workspaces).toHaveLength(1)
  })

  it("creates a workspace without switching to it", async () => {
    const stores = createAppStores(new MockBridge())
    await stores.workspace.getState().load()

    await expect(stores.workspace.getState().create("Project")).resolves.toBe(true)

    expect(stores.workspace.getState().workspaces.map((item) => item.name)).toContain("Project")
    expect(stores.workspace.getState().activeId).toBe("default")
    expect(stores.notifications.getState().queue[0].message).toContain("Project")
  })

  it("clears open buffers and re-lists the explorer when switching", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.workspace.getState().load()
    await stores.editor.getState().openFile("README.md")
    await stores.files.getState().refresh("src")

    await stores.workspace.getState().create("Project")
    const id = projectId(stores, "Project")
    await expect(stores.workspace.getState().open(id)).resolves.toBe(true)

    expect(stores.workspace.getState().activeId).toBe(id)
    expect(stores.editor.getState().docs).toEqual([])
    expect(stores.editor.getState().activePath).toBeNull()
    expect(stores.files.getState().cwd).toBe(".")
    expect(stores.shell.getState().view).toBe("files")
    expect(stores.shell.getState().status).toContain("Project")
  })

  it("ignores a switch to the workspace that is already active", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.workspace.getState().load()
    const open = vi.spyOn(bridge, "openWorkspace")

    await expect(stores.workspace.getState().open("default")).resolves.toBe(true)
    expect(open).not.toHaveBeenCalled()
  })

  it("renames and deletes a workspace, returning to the default root", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    await stores.workspace.getState().load()
    await stores.workspace.getState().create("Project")
    const id = projectId(stores, "Project")
    await stores.workspace.getState().open(id)
    await stores.editor.getState().openFile("README.md")

    await expect(stores.workspace.getState().rename(id, "Journal")).resolves.toBe(true)
    expect(projectId(stores, "Journal")).toBe(id)

    await expect(stores.workspace.getState().remove(id)).resolves.toBe(true)
    expect(confirm).toHaveBeenCalled()
    expect(stores.workspace.getState().workspaces.map((item) => item.id)).toEqual(["default"])
    expect(stores.workspace.getState().activeId).toBe("default")
    expect(stores.editor.getState().docs).toEqual([])
  })

  it("refuses to delete the default workspace", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    const stores = createAppStores(new MockBridge())
    await stores.workspace.getState().load()

    await expect(stores.workspace.getState().remove("default")).resolves.toBe(false)
    expect(stores.workspace.getState().workspaces).toHaveLength(1)
  })

  it("keeps the workspace when the delete confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false)
    const stores = createAppStores(new MockBridge())
    await stores.workspace.getState().load()
    await stores.workspace.getState().create("Project")
    const id = projectId(stores, "Project")

    await expect(stores.workspace.getState().remove(id)).resolves.toBe(false)
    expect(stores.workspace.getState().workspaces.map((item) => item.id)).toContain(id)
  })
})
