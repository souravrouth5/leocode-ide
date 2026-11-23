import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { CompatibilityView } from "./CompatibilityView"
import { PYTHON_COMPATIBILITY_DATA } from "./compatibilityData"
import { PythonProjectPanel } from "./PythonProjectPanel"
import { StoresProvider, createAppStores } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"

afterEach(cleanup)

describe("CompatibilityView", () => {
  it("renders baseline runtime information", () => {
    render(<CompatibilityView />)

    expect(screen.getByText("Python Runtime Baseline")).toBeTruthy()
    expect(screen.getByText("CPython version")).toBeTruthy()
    expect(screen.getByText("3.14.10")).toBeTruthy()
    expect(screen.getByText("Bionic")).toBeTruthy()
    expect(screen.getByText("none (MVP)")).toBeTruthy()
  })

  it("renders tested packages and status badges", () => {
    render(<CompatibilityView />)

    expect(screen.getByText("requests")).toBeTruthy()
    expect(screen.getByText("markupsafe")).toBeTruthy()
    expect(screen.getByText("numpy")).toBeTruthy()
    expect(screen.getByText("charset-normalizer")).toBeTruthy()

    // Status badges exist
    const passBadges = screen.getAllByText("PASS")
    expect(passBadges.length).toBeGreaterThan(0)

    const unsupportedBadges = screen.getAllByText("UNSUPPORTED")
    expect(unsupportedBadges.length).toBeGreaterThan(0)
  })

  it("renders limitation warnings", () => {
    render(<CompatibilityView />)

    expect(screen.getByText(/Known Mobile & Android Limitations/i)).toBeTruthy()
    for (const note of PYTHON_COMPATIBILITY_DATA.limitations) {
      expect(screen.getByText(note)).toBeTruthy()
    }
  })

  it("filters packages by search query", () => {
    render(<CompatibilityView />)

    const searchInput = screen.getByRole("searchbox", { name: /Filter packages/i })
    fireEvent.change(searchInput, { target: { value: "numpy" } })

    expect(screen.getByText("numpy")).toBeTruthy()
    expect(screen.queryByText("requests")).toBeNull()
    expect(screen.queryByText("flask")).toBeNull()
  })

  it("filters packages by category pills", () => {
    render(<CompatibilityView />)

    // Click "Unsupported" filter
    const unsupportedBtn = screen.getByRole("button", { name: "Unsupported" })
    fireEvent.click(unsupportedBtn)

    expect(screen.getByText("numpy")).toBeTruthy()
    expect(screen.queryByText("requests")).toBeNull()
    expect(screen.queryByText("markupsafe")).toBeNull()

    // Click "Pure-Python" filter
    const pureBtn = screen.getByRole("button", { name: "Pure-Python" })
    fireEvent.click(pureBtn)

    expect(screen.getByText("requests")).toBeTruthy()
    expect(screen.getByText("pygments")).toBeTruthy()
    expect(screen.queryByText("numpy")).toBeNull()
    expect(screen.queryByText("markupsafe")).toBeNull()
  })

  it("calls onClose when close button is clicked", () => {
    const onClose = vi.fn()
    render(<CompatibilityView onClose={onClose} />)

    const closeBtn = screen.getByRole("button", { name: "Close compatibility view" })
    fireEvent.click(closeBtn)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("calls onClose when Escape key is pressed", () => {
    const onClose = vi.fn()
    render(<CompatibilityView onClose={onClose} />)

    fireEvent.keyDown(window, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("renders inline when inline prop is true", () => {
    const { container } = render(<CompatibilityView inline />)

    expect(container.querySelector(".python-compatibility")).not.toBeNull()
    expect(container.querySelector(".modal-backdrop")).toBeNull()
  })

  it("does not render when isOpen is false", () => {
    const { container } = render(<CompatibilityView isOpen={false} />)
    expect(container.firstChild).toBeNull()
  })
})

describe("PythonProjectPanel integration", () => {
  it("renders Compatibility and Create Python project buttons", () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)

    render(
      <StoresProvider stores={stores}>
        <PythonProjectPanel />
      </StoresProvider>
    )

    expect(screen.getByRole("button", { name: "Compatibility" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Create Python project" })).toBeTruthy()
  })

  it("opens and closes CompatibilityView modal", () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)

    render(
      <StoresProvider stores={stores}>
        <PythonProjectPanel />
      </StoresProvider>
    )

    // Modal is initially not present
    expect(screen.queryByText("Python Runtime Baseline")).toBeNull()

    // Click Compatibility button
    fireEvent.click(screen.getByRole("button", { name: "Compatibility" }))
    expect(screen.getByText("Python Runtime Baseline")).toBeTruthy()

    // Click close button inside modal
    fireEvent.click(screen.getByRole("button", { name: "Close compatibility view" }))
    expect(screen.queryByText("Python Runtime Baseline")).toBeNull()
  })

  it("creates Python project template files on button click", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)

    render(
      <StoresProvider stores={stores}>
        <PythonProjectPanel />
      </StoresProvider>
    )

    const createBtn = screen.getByRole("button", { name: "Create Python project" })
    fireEvent.click(createBtn)

    await waitFor(async () => {
      const mainContent = await bridge.read("main.py")
      expect(mainContent).toContain("Hello from LeoCode Python!")
    })

    const reqContent = await bridge.read("requirements.txt")
    expect(reqContent).toBe("# Add project dependencies here\n")

    const gitignoreContent = await bridge.read(".gitignore")
    expect(gitignoreContent).toContain("__pycache__/")

    const readmeContent = await bridge.read("README.md")
    expect(readmeContent).toContain("# Python Project")
  })
})
