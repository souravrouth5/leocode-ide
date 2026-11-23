import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StoresProvider, createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"
import type { UpdateCheck } from "../../bridge"
import { UpdatesCard } from "./UpdatesCard"

afterEach(cleanup)

const available: UpdateCheck = {
  available: true,
  currentVersion: "0.1.0-rc1",
  versionName: "0.1.0-rc2",
  versionCode: 1002,
  notes: "Signed self-update demo",
  url: "file:///sdcard/Download/leocode-update/leocode-1002.apk",
  sha256: "a".repeat(64),
  size: 18_000_000
}

function renderCard(bridge: MockBridge) {
  const stores = createAppStores(bridge)
  render(
    <StoresProvider stores={stores}>
      <UpdatesCard version="0.0.1" />
    </StoresProvider>
  )
  return stores
}

describe("Updates card (Task 28)", () => {
  it("checks for updates and reports the current build", async () => {
    renderCard(new MockBridge())

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))

    await waitFor(() => expect(screen.getByText(/is up to date/)).toBeTruthy())
    expect(screen.getByText("0.0.1-mock")).toBeTruthy()
  })

  it("offers a verified release and shows its size", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => available
    renderCard(bridge)

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))

    await waitFor(() => expect(screen.getByText(/0.1.0-rc2 is available/)).toBeTruthy())
    expect(screen.getByText(/17\.2 MB/)).toBeTruthy()
    expect(screen.getByText("Signed self-update demo")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Download and install" })).toBeTruthy()
  })

  it("shows the installer hand-off after a successful download", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => available
    bridge.installUpdate = async (_request, onProgress) => {
      onProgress({ phase: "download", bytes: 9_000_000, total: 18_000_000 })
      onProgress({ phase: "verify", bytes: 18_000_000, total: 18_000_000 })
      onProgress({ phase: "install", bytes: 18_000_000, total: 18_000_000 })
    }
    renderCard(bridge)

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))
    await waitFor(() => expect(screen.getByText(/0.1.0-rc2 is available/)).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: "Download and install" }))

    await waitFor(() =>
      expect(screen.getByText(/Android's installer is open/)).toBeTruthy()
    )
  })

  it("keeps the error visible when the manifest cannot be verified", async () => {
    const bridge = new MockBridge()
    bridge.checkForUpdate = async () => {
      const { AppError } = await import("../../bridge")
      throw new AppError("E_BAD_MANIFEST", "the update manifest signature is missing")
    }
    renderCard(bridge)

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }))

    await waitFor(() =>
      expect(screen.getByText("the update manifest signature is missing")).toBeTruthy()
    )
  })
})
