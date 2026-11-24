import React from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { AppHeader } from "./AppHeader"
import { AppStatusBar } from "./AppStatusBar"
import { MockBridge } from "../../bridge/mock"
import { StoresProvider, createAppStores } from "../../app/stores"

afterEach(cleanup)

describe("R-10 Badge Rule (B4)", () => {
  it("header chip follows root enabled: shows ROOT MODE only when enabled", () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)

    const { rerender } = render(
      <StoresProvider stores={stores}>
        <AppHeader />
      </StoresProvider>
    )

    // By default root is disabled -> no ROOT MODE
    expect(screen.queryByText("ROOT MODE")).toBeNull()
    expect(screen.queryByText("ROOT")).toBeNull()

    // Enable root mode -> shows ROOT MODE
    stores.root.setState({ enabled: true })
    rerender(
      <StoresProvider stores={stores}>
        <AppHeader />
      </StoresProvider>
    )

    expect(screen.getByText("ROOT MODE")).toBeDefined()

    // Disable root mode -> ROOT MODE disappears
    stores.root.setState({ enabled: false })
    rerender(
      <StoresProvider stores={stores}>
        <AppHeader />
      </StoresProvider>
    )

    expect(screen.queryByText("ROOT MODE")).toBeNull()
  })

  it("status bar shows # ROOT badge only while liveRootCount > 0", () => {
    const bridge = new MockBridge()
    const stores = createAppStores(bridge)

    const { rerender } = render(
      <StoresProvider stores={stores}>
        <AppStatusBar />
      </StoresProvider>
    )

    // liveRootCount == 0 -> no # ROOT
    expect(screen.queryByText("# ROOT")).toBeNull()

    // liveRootCount > 0 -> shows # ROOT
    stores.root.setState({ liveRootCount: 1 })
    rerender(
      <StoresProvider stores={stores}>
        <AppStatusBar />
      </StoresProvider>
    )

    expect(screen.getByText("# ROOT")).toBeDefined()

    // liveRootCount back to 0 -> # ROOT disappears
    stores.root.setState({ liveRootCount: 0 })
    rerender(
      <StoresProvider stores={stores}>
        <AppStatusBar />
      </StoresProvider>
    )

    expect(screen.queryByText("# ROOT")).toBeNull()
  })
})
