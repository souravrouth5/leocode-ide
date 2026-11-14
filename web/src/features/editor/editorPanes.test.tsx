import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { StoresProvider, createAppStores, type AppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"
import { ThemeProvider } from "../../theme/ThemeProvider"
import { EditorView } from "./EditorView"

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

const openDoc = (path: string, content: string) => ({
  path,
  content,
  saved: content,
  eol: "\n" as const
})

describe("per-tab editor state (W-24)", () => {
  it("keeps one mounted pane per document across a tab switch", async () => {
    const stores = makeStores()
    stores.editor.setState({
      docs: [openDoc("a.txt", "alpha"), openDoc("b.txt", "bravo")],
      activePath: "a.txt"
    })

    render(
      <ThemeProvider bridge={stores.bridge}>
        <StoresProvider stores={stores}>
          <EditorView />
        </StoresProvider>
      </ThemeProvider>
    )

    await waitFor(() => expect(document.querySelectorAll(".editor-host")).toHaveLength(2), {
      timeout: 5_000
    })

    const slots = Array.from(document.querySelectorAll<HTMLElement>(".editor-pane-slot"))
    expect(slots[0].style.display).toBe("flex")
    expect(slots[1].style.display).toBe("none")

    // The first pane (and its CodeMirror state) must survive the switch.
    const firstPane = slots[0].firstElementChild
    act(() => {
      stores.editor.getState().setActive("b.txt")
    })
    await waitFor(() => expect(slots[1].style.display).toBe("flex"))

    expect(slots[0].style.display).toBe("none")
    expect(slots[0].firstElementChild).toBe(firstPane)
    expect(document.querySelectorAll(".editor-host")).toHaveLength(2)
    expect(screen.getAllByRole("tab")).toHaveLength(2)
  })
})
