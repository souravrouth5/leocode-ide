import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { PromptDialog } from "./PromptDialog"

afterEach(cleanup)

const type = (value: string) => {
  const input = screen.getByRole("textbox") as HTMLInputElement
  fireEvent.change(input, { target: { value } })
}

describe("PromptDialog inline errors (W-28)", () => {
  it("stays open with the inline message when onConfirm returns an error", async () => {
    const onClose = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue("notes.txt already exists")

    render(
      <PromptDialog
        open
        title="New file"
        label="File name"
        onConfirm={onConfirm}
        onClose={onClose}
      />
    )
    type("notes.txt")
    fireEvent.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already exists"))
    expect(onClose).not.toHaveBeenCalled()
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("notes.txt")
  })

  it("clears the error while the user edits the name", async () => {
    render(
      <PromptDialog
        open
        title="New file"
        onConfirm={() => "not a valid name"}
        onClose={vi.fn()}
      />
    )
    type("bad/name")
    fireEvent.click(screen.getByRole("button", { name: "Create" }))
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())

    type("good-name")

    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("does not submit an empty value", async () => {
    const onConfirm = vi.fn()
    render(<PromptDialog open title="New file" onConfirm={onConfirm} onClose={vi.fn()} />)
    type("   ")
    // The Create button is disabled for blank input, so submit the form itself.
    fireEvent.submit((screen.getByRole("textbox") as HTMLInputElement).closest("form")!)

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Enter a value"))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it("closes only after a successful onConfirm", async () => {
    const onClose = vi.fn()
    render(
      <PromptDialog
        open
        title="Rename"
        initialValue="old.txt"
        confirmLabel="Rename"
        onConfirm={() => null}
        onClose={onClose}
      />
    )
    fireEvent.click(screen.getByRole("button", { name: "Rename" }))

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })
})
