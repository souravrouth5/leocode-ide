import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Snackbar } from "./Snackbar"
import { InlineBanner } from "./InlineBanner"
import { ErrorSheet } from "./ErrorSheet"
import { ErrorBoundary } from "./ErrorBoundary"
import { PaneError } from "./CrashScreen"
import { AppError } from "../bridge/types"
import type { ActiveError } from "./errorsStore"

afterEach(cleanup)

describe("error surfaces (Task 12)", () => {
  it("renders a snackbar with detail and runs its action", () => {
    const onDismiss = vi.fn()
    const run = vi.fn()
    render(
      <Snackbar
        notice={{
          id: "n1",
          kind: "warning",
          message: "Not found",
          detail: "gone",
          durationMs: null,
          action: { label: "Undo", run }
        }}
        onDismiss={onDismiss}
      />
    )

    expect(screen.getByRole("status").textContent).toContain("Not found")
    expect(screen.getByText("gone")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Undo" }))
    expect(run).toHaveBeenCalledTimes(1)
    expect(onDismiss).toHaveBeenCalledWith("n1")
  })

  it("dismisses a banner and runs its action", () => {
    const onDismiss = vi.fn()
    const onAction = vi.fn()
    render(
      <InlineBanner
        title="The file changed on disk"
        message="Reload to take the disk version"
        actionLabel="Reload"
        onAction={onAction}
        onDismiss={onDismiss}
      />
    )

    expect(screen.getByRole("alert").textContent).toContain("changed on disk")
    fireEvent.click(screen.getByRole("button", { name: "Reload" }))
    expect(onAction).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it("shows the catalog copy in the error sheet and retries", () => {
    const retry = vi.fn()
    const onClose = vi.fn()
    const active: ActiveError = {
      error: new AppError("E_DISK_FULL", "no space left"),
      entry: {
        title: "The device is out of space",
        explanation: "Free some storage and try again.",
        surface: "sheet",
        severity: "error",
        action: { label: "Dismiss", kind: "dismiss" }
      },
      context: "Save file",
      retry
    }

    const { rerender } = render(<ErrorSheet active={active} onClose={onClose} />)
    expect(screen.getByRole("dialog").textContent).toContain("out of space")
    expect(screen.getByText("no space left")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }))
    expect(onClose).toHaveBeenCalled()

    rerender(
      <ErrorSheet
        active={{
          ...active,
          entry: { ...active.entry, action: { label: "Try again", kind: "retry" } }
        }}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it("contains a pane crash and resets once the cause is fixed", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    let shouldThrow = true
    function Bomb() {
      if (shouldThrow) throw new Error("render exploded")
      return <div>recovered</div>
    }

    render(
      <ErrorBoundary
        fallback={(error, reset) => (
          <PaneError error={error} onRetry={reset} title="This panel crashed" />
        )}
      >
        <Bomb />
      </ErrorBoundary>
    )

    expect(screen.getByRole("alert").textContent).toContain("render exploded")
    shouldThrow = false
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(screen.getByText("recovered")).toBeTruthy()
    spy.mockRestore()
  })

  it("copies error details", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    })
    const onNotice = vi.fn()
    const active: ActiveError = {
      error: new AppError("E_IO", "write failed"),
      entry: {
        title: "Storage error",
        explanation: "Android refused the file operation.",
        surface: "sheet",
        severity: "error",
        action: { label: "Dismiss", kind: "dismiss" }
      }
    }

    render(<ErrorSheet active={active} onClose={vi.fn()} onNotice={onNotice} />)
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }))
    await Promise.resolve()
    await Promise.resolve()

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText.mock.calls[0][0]).toContain("E_IO")
  })
})
