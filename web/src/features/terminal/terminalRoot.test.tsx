import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { TerminalPane } from "./TerminalPane"
import { MockBridge } from "../../bridge/mock"
import { StoresProvider, createAppStores } from "../../app/stores"

afterEach(cleanup)

describe("TerminalPane root mode & loss UX (B4)", () => {
  it("shows root lost banner and marks tab ended for its sessionId, ignores others", async () => {
    const bridge = new MockBridge()
    await bridge.rootRequest()
    const stores = createAppStores(bridge)

    let rootLostListener: ((evt: any) => void) | null = null
    bridge.onRootLost = (fn) => {
      rootLostListener = fn
      return () => {
        rootLostListener = null
      }
    }

    let openedSessionId = ""
    bridge.openTerminal = vi.fn(async (options) => {
      openedSessionId = "session-root-42"
      return {
        sessionId: openedSessionId,
        alive: true,
        write: vi.fn(),
        resize: vi.fn(),
        close: vi.fn(() => options.onExit(-1)),
        detach: vi.fn()
      }
    })

    render(
      <StoresProvider stores={stores}>
        <TerminalPane
          bridge={bridge}
          cwd="."
          active={true}
          dark={true}
          rootStore={stores.root}
        />
      </StoresProvider>
    )

    // Switch to root shell
    const rootShellBtn = await screen.findByRole("button", { name: /Root Shell/i })
    fireEvent.click(rootShellBtn)

    await waitFor(() => {
      expect(screen.getByText("# ROOT")).toBeDefined()
    })

    // Fire root.lost for an unrelated session id -> should be ignored
    rootLostListener!({ sessionId: "unrelated-session-99", reason: "denied" })

    expect(screen.queryByText(/Root access was refused. The root session ended./)).toBeNull()
    expect(screen.getByText("# ROOT")).toBeDefined()

    // Fire root.lost for this session id -> tab ended, banner displayed, # ROOT hidden
    rootLostListener!({ sessionId: openedSessionId, reason: "revoked" })

    await waitFor(() => {
      expect(screen.getByText(/Root access was refused. The root session ended./)).toBeDefined()
    })

    // When ended/closed, the # ROOT badge must not be shown
    expect(screen.queryByText("# ROOT")).toBeNull()

    // Banner has "Try again" and "Open normal shell"
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined()
    const normalShellBtn = screen.getByRole("button", { name: "Open normal shell" })
    expect(normalShellBtn).toBeDefined()

    // Clicking "Open normal shell" dismisses the banner and exits root mode
    fireEvent.click(normalShellBtn)

    await waitFor(() => {
      expect(screen.queryByText(/Root access was refused. The root session ended./)).toBeNull()
    })
  })
})
