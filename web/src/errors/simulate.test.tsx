import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import App from "../App"

afterEach(() => {
  cleanup()
  window.history.replaceState({}, "", "/")
})

describe("?simulate error surfaces (Task 12)", () => {
  it("opens the disk-full sheet", async () => {
    window.history.replaceState({}, "", "/?simulate=E_DISK_FULL")
    render(<App />)

    await waitFor(
      () => {
        const dialog = screen.getByRole("dialog", { name: "The device is out of space" })
        expect(dialog.textContent).toContain("Free some storage")
      },
      { timeout: 5_000 }
    )
  })

  it("shows the timeout banner", async () => {
    window.history.replaceState({}, "", "/?simulate=E_TIMEOUT")
    render(<App />)

    await waitFor(
      () => {
        const banner = screen.getByRole("alert")
        expect(banner.textContent).toContain("took too long")
      },
      { timeout: 5_000 }
    )
  })

  it("queues a snackbar for a missing file", async () => {
    window.history.replaceState({}, "", "/?simulate=E_NOT_FOUND")
    render(<App />)

    await waitFor(
      () => {
        expect(screen.getByRole("status").textContent).toContain("Not found")
      },
      { timeout: 5_000 }
    )
  })
})
