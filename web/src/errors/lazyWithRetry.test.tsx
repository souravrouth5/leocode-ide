import { Suspense } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { lazyWithRetry } from "./lazyWithRetry"

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})

describe("lazyWithRetry (W-35)", () => {
  it("clears the stale-chunk flag after a successful load", async () => {
    sessionStorage.setItem("leocode.chunk-retry", "1")
    const Pane = lazyWithRetry(async () => ({ default: () => <div>pane ready</div> }))

    render(
      <Suspense fallback={<div>loading</div>}>
        <Pane />
      </Suspense>
    )

    await waitFor(() => expect(screen.getByText("pane ready")).toBeTruthy())
    // The retry budget is re-armed for the next deploy in the same session.
    expect(sessionStorage.getItem("leocode.chunk-retry")).toBeNull()
  })
})
