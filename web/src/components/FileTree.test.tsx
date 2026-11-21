import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { StoresProvider, createAppStores, type AppStores } from "../app/stores"
import { MockBridge } from "../bridge/mock"
import type { FileEntry } from "../bridge"
import { FileTree } from "./FileTree"

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
  localStorage.clear()
})

const entry: FileEntry = {
  name: "README.md",
  path: "README.md",
  kind: "file",
  size: 10,
  mtime: 0
}

const renderTree = (stores: AppStores, onOpen: (item: FileEntry) => void) =>
  render(
    <StoresProvider stores={stores}>
      <FileTree
        path="."
        entries={[entry]}
        loading={false}
        onOpen={onOpen}
        onNavigate={vi.fn()}
        onRefresh={vi.fn()}
        onCreate={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    </StoresProvider>
  )

const row = () => screen.getByText("README.md").closest("button") as HTMLButtonElement

describe("file row activation (W-32)", () => {
  it("opens on Enter and Space, and a key press is not repeated by click", () => {
    const onOpen = vi.fn()
    renderTree(makeStores(), onOpen)

    fireEvent.keyDown(row(), { key: "Enter" })
    expect(onOpen).toHaveBeenCalledTimes(1)

    // The browser's synthetic click after the key press must not open twice.
    fireEvent.click(row())
    expect(onOpen).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(row(), { key: " " })
    expect(onOpen).toHaveBeenCalledTimes(2)
    fireEvent.click(row())
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it("still opens on a plain click (assistive activation)", () => {
    const onOpen = vi.fn()
    renderTree(makeStores(), onOpen)

    fireEvent.click(row())

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("keeps the long-press action sheet", () => {
    vi.useFakeTimers()
    try {
      renderTree(makeStores(), vi.fn())
      fireEvent.pointerDown(row())
      vi.advanceTimersByTime(500)
      expect(screen.getByText("Rename")).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})
