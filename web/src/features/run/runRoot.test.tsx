import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { RunSheet } from "./RunSheet"
import { MockBridge } from "../../bridge/mock"
import { StoresProvider, createAppStores } from "../../app/stores"

afterEach(cleanup)

describe("RunSheet root mode & loss UX (B4)", () => {
  it("shows # ROOT badge only while process is running as root", () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)

    const { rerender } = render(
      <StoresProvider stores={stores}>
        <RunSheet
          open={true}
          title="test.py"
          running={true}
          isRoot={true}
          exitCode={null}
          segments={[]}
          onStop={() => {}}
          onClose={() => {}}
        />
      </StoresProvider>
    )

    // Running as root -> shows # ROOT
    expect(screen.getByText("# ROOT")).toBeDefined()

    // Stopped/finished -> # ROOT is hidden
    rerender(
      <StoresProvider stores={stores}>
        <RunSheet
          open={true}
          title="test.py"
          running={false}
          isRoot={true}
          exitCode={0}
          segments={[]}
          onStop={() => {}}
          onClose={() => {}}
        />
      </StoresProvider>
    )
    expect(screen.queryByText("# ROOT")).toBeNull()

    // Running non-root -> # ROOT is hidden
    rerender(
      <StoresProvider stores={stores}>
        <RunSheet
          open={true}
          title="test.py"
          running={true}
          isRoot={false}
          exitCode={null}
          segments={[]}
          onStop={() => {}}
          onClose={() => {}}
        />
      </StoresProvider>
    )
    expect(screen.queryByText("# ROOT")).toBeNull()
  })

  it("shows root lost banner when root.lost event matches active job", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    const runStore = stores.run

    // Set an active run with jobId
    runStore.setState({
      sheetOpen: true,
      runAsRoot: true,
      run: {
        title: "test.py",
        running: true,
        exitCode: null,
        segments: [],
        hint: null,
        jobId: "active-root-job-123",
        rootLost: false
      }
    })

    const onRetry = vi.fn()

    render(
      <StoresProvider stores={stores}>
        <RunSheet
          open={true}
          title="test.py"
          running={true}
          exitCode={null}
          segments={[]}
          onStop={() => {}}
          onClose={() => {}}
          onRetryRoot={onRetry}
        />
      </StoresProvider>
    )

    expect(screen.queryByText(/Root access was refused. The process ended./)).toBeNull()

    // Fire root lost for active job
    bridge.emitRootLost({ jobId: "active-root-job-123", reason: "revoked" })

    await waitFor(() => {
      expect(screen.getByText(/Root access was refused. The process ended./)).toBeDefined()
    })

    const tryAgainBtn = screen.getByRole("button", { name: "Try again" })
    expect(tryAgainBtn).toBeDefined()
    fireEvent.click(tryAgainBtn)

    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("ignores root.lost event with a different jobId while a root run is active", async () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)
    const runStore = stores.run

    runStore.setState({
      sheetOpen: true,
      runAsRoot: true,
      run: {
        title: "test.py",
        running: true,
        exitCode: null,
        segments: [],
        hint: null,
        jobId: "active-root-job-123",
        rootLost: false
      }
    })

    render(
      <StoresProvider stores={stores}>
        <RunSheet
          open={true}
          title="test.py"
          running={true}
          exitCode={null}
          segments={[]}
          onStop={() => {}}
          onClose={() => {}}
        />
      </StoresProvider>
    )

    // Fire root lost for a different job (e.g. phantom apply)
    bridge.emitRootLost({ jobId: "other-phantom-job-456", reason: "denied" })

    // Active run must remain running and rootLost false
    expect(runStore.getState().run?.running).toBe(true)
    expect(runStore.getState().run?.rootLost).toBe(false)
    expect(screen.queryByText(/Root access was refused. The process ended./)).toBeNull()
  })
})
