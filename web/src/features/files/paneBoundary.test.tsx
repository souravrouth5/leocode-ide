import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { StoresProvider, createAppStores, type AppStores } from "../../app/stores"
import type { FileEntry } from "../../bridge"
import { MockBridge } from "../../bridge/mock"
import { ExplorerDrawer } from "./ExplorerDrawer"
import { FilesView } from "./FilesView"

const created: AppStores[] = []
const makeStores = () => {
  const stores = createAppStores(new MockBridge())
  created.push(stores)
  return stores
}

afterEach(() => {
  cleanup()
  for (const stores of created.splice(0)) stores.dispose()
  vi.restoreAllMocks()
})

describe("pane boundaries (W-29)", () => {
  it("contains a file-tree crash to the files pane", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const stores = makeStores()
    stores.shell.getState().setView("files")
    stores.files.setState({ entries: null as unknown as FileEntry[] })

    render(
      <StoresProvider stores={stores}>
        <FilesView />
      </StoresProvider>
    )

    expect(screen.getByRole("alert").textContent).toContain("The file list crashed")
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  it("contains a drawer crash and leaves the files pane rendered", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const stores = makeStores()
    stores.shell.getState().setView("files")
    const settings = stores.settings.getState().settings
    stores.settings.setState({
      settings: { ...settings, bookmarks: "not-a-list" as unknown as string[] }
    })

    render(
      <StoresProvider stores={stores}>
        <FilesView />
        <ExplorerDrawer version="test" />
      </StoresProvider>
    )

    expect(screen.getByRole("alert").textContent).toContain("The explorer drawer crashed")
    // The files pane did not crash: its toolbar is still there.
    expect(screen.getAllByLabelText("Refresh").length).toBeGreaterThan(0)
  })
})
