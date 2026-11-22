import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { DiagnosticsSheet } from "./DiagnosticsSheet"
import { MockBridge } from "../../bridge/mock"
import { AppError } from "../../bridge/types"
import { catalogFor } from "../../errors/catalog"
import type { ActiveError } from "../../errors/errorsStore"

afterEach(cleanup)

const reportText = () =>
  (document.querySelector(".diagnostics-report") as HTMLElement | null)?.textContent ?? ""

const renderSheet = (
  bridge: MockBridge,
  recentErrors: ActiveError[] = [],
  onNotice = vi.fn()
) =>
  render(
    <DiagnosticsSheet
      open
      onClose={vi.fn()}
      bridge={bridge}
      recentErrors={recentErrors}
      version="0.1.0"
      onNotice={onNotice}
    />
  )

describe("DiagnosticsSheet (Task 27)", () => {
  it("renders the native report text once loaded", async () => {
    renderSheet(new MockBridge())

    await waitFor(() => expect(reportText()).toContain("Runtimes"))
    expect(reportText()).toContain("LeoCode diagnostics")
  })

  it("appends recent errors and redacts their paths and tokens", async () => {
    const active: ActiveError = {
      error: new AppError(
        "E_IO",
        "/data/data/dev.leocode/files/secret token=abc123"
      ),
      entry: catalogFor("E_IO"),
      context: "Save file",
      correlationId: "lc-test-1",
      at: Date.now()
    }

    renderSheet(new MockBridge(), [active])
    await waitFor(() => expect(reportText()).toContain("Runtimes"))

    const text = reportText()
    expect(text).toContain("E_IO")
    expect(text).toContain("<path>")
    expect(text).toContain("<redacted>")
    expect(text).not.toContain("/data/")
    expect(text).not.toContain("abc123")
  })

  it("copies exactly the visible text and reports success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    })
    const onNotice = vi.fn()

    renderSheet(new MockBridge(), [], onNotice)
    await waitFor(() => expect(reportText()).toContain("Runtimes"))
    const visible = reportText()

    fireEvent.click(screen.getByRole("button", { name: "Copy" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))

    expect(writeText.mock.calls[0][0]).toBe(visible)
    expect(onNotice).toHaveBeenCalledWith("Diagnostics copied")
  })

  it("uses the native share sheet when the bridge provides one", async () => {
    const bridge = new MockBridge()
    const shared = vi.spyOn(bridge, "shareText").mockResolvedValue(true)
    const onNotice = vi.fn()

    renderSheet(bridge, [], onNotice)
    await waitFor(() => expect(reportText()).toContain("Runtimes"))
    const visible = reportText()

    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    await waitFor(() => expect(shared).toHaveBeenCalledWith(visible))
    expect(onNotice).toHaveBeenCalledWith("Diagnostics shared")
  })

  it("falls back to copying when no share target is available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    })
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined
    })
    const onNotice = vi.fn()

    renderSheet(new MockBridge(), [], onNotice)
    await waitFor(() => expect(reportText()).toContain("Runtimes"))
    const visible = reportText()

    fireEvent.click(screen.getByRole("button", { name: "Share" }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(visible))
    expect(onNotice).toHaveBeenCalledWith("Diagnostics copied")
  })

  it("shows a redacted fallback when the native report fails", async () => {
    const bridge = new MockBridge()
    vi.spyOn(bridge, "diagnostics").mockRejectedValue(
      new Error("/data/data/dev.leocode/files/secret token=abc123")
    )

    renderSheet(bridge)
    await waitFor(() =>
      expect(reportText()).toContain("Native report unavailable:")
    )

    const text = reportText()
    expect(screen.getByRole("dialog")).toBeTruthy()
    expect(text).toContain("<path>")
    expect(text).toContain("<redacted>")
    expect(text).not.toContain("/data/")
    expect(text).not.toContain("abc123")
  })
})
