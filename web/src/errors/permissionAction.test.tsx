import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { catalogFor } from "./catalog"
import { ErrorSheet } from "./ErrorSheet"
import type { ActiveError } from "./errorsStore"
import { AppError } from "../bridge/types"

afterEach(cleanup)

const active = (code: "E_PERMISSION" | "E_PATH_OUTSIDE_ROOT" | "E_DISK_FULL"): ActiveError => ({
  error: new AppError(code, "denied"),
  entry: catalogFor(code)
})

describe("storage permission action (W-27)", () => {
  it("offers Grant storage access for E_PERMISSION", () => {
    const grant = vi.fn()
    const onClose = vi.fn()
    render(
      <ErrorSheet
        active={active("E_PERMISSION")}
        onClose={onClose}
        onRequestStoragePermission={grant}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Grant storage access" }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(grant).toHaveBeenCalledTimes(1)
  })

  it("offers the same action for a path outside the root", () => {
    const grant = vi.fn()
    render(
      <ErrorSheet
        active={active("E_PATH_OUTSIDE_ROOT")}
        onClose={vi.fn()}
        onRequestStoragePermission={grant}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Grant storage access" }))
    expect(grant).toHaveBeenCalledTimes(1)
  })

  it("keeps Dismiss for errors a permission cannot fix", () => {
    render(
      <ErrorSheet
        active={active("E_DISK_FULL")}
        onClose={vi.fn()}
        onRequestStoragePermission={vi.fn()}
      />
    )

    expect(screen.queryByRole("button", { name: "Grant storage access" })).toBeNull()
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeTruthy()
  })
})
