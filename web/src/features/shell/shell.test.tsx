import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import App from "../../App"

afterEach(() => {
  cleanup()
  window.history.replaceState({}, "", "/")
})

describe("mock-mode shell smoke (Task 13)", () => {
  it("boots, loads the mock list and shows the editor empty state", async () => {
    render(<App />)

    await waitFor(
      () => {
        expect(screen.getAllByText("README.md").length).toBeGreaterThan(0)
      },
      { timeout: 5_000 }
    )
    expect(screen.getByText("No file open")).toBeTruthy()
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy()
    expect(screen.getByText("preview")).toBeTruthy()
  })

  it("switches to the terminal view without crashing", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0))

    const nav = screen.getByRole("navigation", { name: "Main" })
    within(nav).getByRole("button", { name: /Terminal/ }).click()

    await waitFor(
      () => {
        expect(document.querySelector(".terminal-view.current")).not.toBeNull()
      },
      { timeout: 5_000 }
    )
  })

  it("opens the Git tab for a workspace without a repository", async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText("README.md").length).toBeGreaterThan(0))

    const nav = screen.getByRole("navigation", { name: "Main" })
    within(nav).getByRole("button", { name: /^Git$/ }).click()

    await waitFor(
      () => {
        expect(document.querySelector(".git-view.current")).not.toBeNull()
        expect(screen.getByText("Initialize repository")).toBeTruthy()
      },
      { timeout: 5_000 }
    )
  })
})
