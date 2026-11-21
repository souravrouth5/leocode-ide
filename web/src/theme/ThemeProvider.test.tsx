import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { THEME_READ_FAILED, THEME_WRITE_FAILED, ThemeProvider, useTheme } from "./ThemeProvider"
import { MockBridge } from "../bridge/mock"
import { AppError, type ThemeState } from "../bridge/types"

afterEach(cleanup)

class FailingSetThemeBridge extends MockBridge {
  override async setTheme(): Promise<ThemeState> {
    throw new AppError("E_TIMEOUT", "app.theme.set timed out after 10 s")
  }
}

class FailingGetThemeBridge extends MockBridge {
  override async getTheme(): Promise<ThemeState> {
    throw new AppError("E_TIMEOUT", "app.theme.get timed out after 10 s")
  }
}

function Probe() {
  const { setMode } = useTheme()
  return (
    <button
      onClick={() => {
        setMode("dark")
        setMode("light")
        setMode("dark")
      }}
    >
      switch theme
    </button>
  )
}

describe("theme failures are not silent (W-23)", () => {
  it("reports a burst of failed theme saves once", async () => {
    const onError = vi.fn()
    render(
      <ThemeProvider bridge={new FailingSetThemeBridge()} onError={onError}>
        <Probe />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByText("switch theme"))

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    const [error, context] = onError.mock.calls[0] as [AppError, string]
    expect(context).toBe(THEME_WRITE_FAILED)
    // The user-facing message says what failed, and keeps the bridge code.
    expect(error.code).toBe("E_TIMEOUT")
    expect(error.message).toContain(THEME_WRITE_FAILED)
  })

  it("reports a failed theme read", async () => {
    const onError = vi.fn()
    render(
      <ThemeProvider bridge={new FailingGetThemeBridge()} onError={onError}>
        {null}
      </ThemeProvider>
    )

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    expect(onError.mock.calls[0][1]).toBe(THEME_READ_FAILED)
  })

  it("stays quiet when the theme round trip succeeds", async () => {
    const onError = vi.fn()
    render(
      <ThemeProvider bridge={new MockBridge()} onError={onError}>
        <Probe />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByText("switch theme"))
    // Let the resolved getTheme/setTheme promises settle.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onError).not.toHaveBeenCalled()
  })
})
