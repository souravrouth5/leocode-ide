import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Snackbar } from "./Snackbar"
import { InlineBanner } from "./InlineBanner"
import { ErrorSheet } from "./ErrorSheet"
import { ErrorBoundary } from "./ErrorBoundary"
import { ErrorSurfaces } from "./ErrorSurfaces"
import { PaneError } from "./CrashScreen"
import { createErrorsStore, type ActiveError } from "./errorsStore"
import { createNotificationsStore } from "../notifications/notificationsStore"
import { AppError } from "../bridge/types"

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

  it("redacts the message it renders and copies (W-09)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    })
    const active: ActiveError = {
      error: new AppError(
        "E_AUTH",
        "Bearer abcdefghijklmnop for https://user:hunter2@git.example.com/x from /data/user/0/dev.leocode"
      ),
      entry: {
        title: "Authentication failed",
        explanation: "The remote service rejected the saved credential.",
        surface: "sheet",
        severity: "error",
        action: { label: "Dismiss", kind: "dismiss" }
      },
      context: "Push /storage/emulated/0/Download/repo",
      correlationId: "lc-test-9"
    }

    render(<ErrorSheet active={active} onClose={vi.fn()} version="0.1.0" />)
    const text = screen.getByRole("dialog").textContent ?? ""
    expect(text).not.toContain("hunter2")
    expect(text).not.toContain("abcdefghijklmnop")
    expect(text).not.toContain("/data/user/0")
    expect(text).not.toContain("/storage/emulated/0")
    expect(text).toContain("<redacted>")

    fireEvent.click(screen.getByRole("button", { name: "Copy details" }))
    await Promise.resolve()
    await Promise.resolve()
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).toContain("Version: 0.1.0")
    expect(copied).toContain("Correlation: lc-test-9")
    expect(copied).not.toContain("hunter2")
  })

  it("redacts the banner message (W-09)", () => {
    const notifications = createNotificationsStore()
    const errors = createErrorsStore((notice) => notifications.getState().enqueue(notice))
    errors.getState().report(
      new AppError(
        "E_TIMEOUT",
        "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz at /data/user/0/dev.leocode/files"
      )
    )

    render(
      <ErrorSurfaces errors={errors} notifications={notifications} version="0.1.0" />
    )
    const banner = screen.getByRole("alert").textContent ?? ""
    expect(banner).toContain("<redacted>")
    expect(banner).not.toContain("ghp_")
    expect(banner).not.toContain("/data/user/0")
  })

  it("redacts a copied pane crash (W-09)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    })

    render(
      <PaneError
        error={new Error("sk-proj-abcdefghijklmnop1234 leaked from /storage/emulated/0/x")}
        onRetry={vi.fn()}
      />
    )

    expect(screen.getByRole("alert").textContent).not.toContain("sk-proj-")
    fireEvent.click(screen.getByRole("button", { name: "Copy details" }))
    await Promise.resolve()
    await Promise.resolve()
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).not.toContain("sk-proj-")
    expect(copied).not.toContain("/storage/emulated/0")
  })
})
