import { afterEach, describe, it, expect, vi } from "vitest"
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SettingsDialog } from "./SettingsDialog"
import { DEFAULT_SETTINGS } from "../settings/userSettings"
import { PHANTOM_COMMAND_ARGV } from "../features/root/phantom"
import type { Bridge, ProcessEvent } from "../bridge/types"

afterEach(cleanup)

describe("SettingsDialog phantom option (R-09)", () => {
  const baseProps = {
    open: true,
    onClose: vi.fn(),
    settings: DEFAULT_SETTINGS,
    onUpdate: vi.fn(),
    bridgeMode: "mock",
    version: "0.1.0",
    onOpenRuntimes: vi.fn(),
    initialTab: "about" as const
  }

  it("hides the phantom option button when root is disabled", () => {
    render(
      <SettingsDialog
        {...baseProps}
        androidSdk={34}
        rootEnabled={false}
        rootLost={false}
      />
    )
    expect(screen.queryByRole("button", { name: "Apply until reboot" })).toBeNull()
  })

  it("hides the phantom option button when SDK < 31", () => {
    render(
      <SettingsDialog
        {...baseProps}
        androidSdk={30}
        rootEnabled={true}
        rootLost={false}
      />
    )
    expect(screen.queryByRole("button", { name: "Apply until reboot" })).toBeNull()
  })

  it("hides the phantom option button when SDK is unknown/null", () => {
    render(
      <SettingsDialog
        {...baseProps}
        androidSdk={null}
        rootEnabled={true}
        rootLost={false}
      />
    )
    expect(screen.queryByRole("button", { name: "Apply until reboot" })).toBeNull()
  })

  it("hides the phantom option button when root is in a lost state", () => {
    render(
      <SettingsDialog
        {...baseProps}
        androidSdk={34}
        rootEnabled={true}
        rootLost={true}
      />
    )
    expect(screen.queryByRole("button", { name: "Apply until reboot" })).toBeNull()
  })

  it("shows the phantom option button when root is enabled, SDK >= 31, and not lost", () => {
    render(
      <SettingsDialog
        {...baseProps}
        androidSdk={34}
        rootEnabled={true}
        rootLost={false}
      />
    )
    expect(screen.getByRole("button", { name: "Apply until reboot" })).toBeDefined()
  })

  it("tapping Apply until reboot opens confirm dialog; Cancel sends nothing", () => {
    const runMock = vi.fn()
    const mockBridge = { run: runMock } as unknown as Bridge

    render(
      <SettingsDialog
        {...baseProps}
        androidSdk={34}
        rootEnabled={true}
        rootLost={false}
        bridge={mockBridge}
      />
    )

    const applyUntilRebootBtn = screen.getByRole("button", { name: "Apply until reboot" })
    fireEvent.click(applyUntilRebootBtn)

    // Confirm dialog is displayed with explanatory text
    expect(
      screen.getByText(/Raises Android's background child-process limit until the next reboot/)
    ).toBeDefined()
    expect(screen.getByRole("heading", { name: "Phantom-process limit" })).toBeDefined()

    // Clicking Cancel closes the confirm dialog without calling bridge.run
    const cancelBtn = screen.getByRole("button", { name: "Cancel" })
    fireEvent.click(cancelBtn)

    expect(runMock).not.toHaveBeenCalled()
    expect(
      screen.queryByText(/Raises Android's background child-process limit until the next reboot/)
    ).toBeNull()
  })

  it("tapping Apply sends exactly the argv with root: true and displays read-back value", async () => {
    const runMock = vi.fn().mockImplementation(
      (_argv: string[], _cwd: string, onEvent: (event: ProcessEvent) => void) => {
        onEvent({ stream: "stdout", data: "2147483647\n" })
        return Promise.resolve(0)
      }
    )
    const mockBridge = { run: runMock } as unknown as Bridge
    const onSuccess = vi.fn()

    render(
      <SettingsDialog
        {...baseProps}
        androidSdk={34}
        rootEnabled={true}
        rootLost={false}
        bridge={mockBridge}
        onApplyPhantomSuccess={onSuccess}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Apply until reboot" }))

    const applyConfirmBtn = screen.getByRole("button", { name: "Apply" })
    fireEvent.click(applyConfirmBtn)

    await waitFor(() => {
      expect(runMock).toHaveBeenCalledWith(
        [...PHANTOM_COMMAND_ARGV],
        ".",
        expect.any(Function),
        undefined,
        { root: true, timeoutMs: 15000 }
      )
    })

    await waitFor(() => {
      expect(screen.getByText("Applied (2147483647)")).toBeDefined()
    })
    expect(onSuccess).toHaveBeenCalledWith("2147483647")
  })

  it("routes error to onApplyPhantomError when command fails", async () => {
    const runMock = vi.fn().mockRejectedValue(new Error("Bridge execution failure"))
    const mockBridge = { run: runMock } as unknown as Bridge
    const onError = vi.fn()

    render(
      <SettingsDialog
        {...baseProps}
        androidSdk={34}
        rootEnabled={true}
        rootLost={false}
        bridge={mockBridge}
        onApplyPhantomError={onError}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Apply until reboot" }))
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.any(Error))
    })
  })
})
