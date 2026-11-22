import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Onboarding, ONBOARDING_STEPS } from "./Onboarding"
import {
  hasSeenOnboarding,
  markOnboardingSeen,
  resetOnboarding
} from "./onboarding"

afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
})

function Harness({ onFinish = vi.fn() }: { onFinish?: () => void }) {
  const [step, setStep] = useState(0)
  return <Onboarding open step={step} onStep={setStep} onFinish={onFinish} />
}

describe("first-run onboarding (Task 27)", () => {
  it("shows the storage, battery and trust screens in order", () => {
    render(<Harness />)

    expect(screen.getByRole("dialog", { name: "Welcome to LeoCode" })).toBeTruthy()
    expect(screen.getByText("Your files live here")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Keep LeoCode alive")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("Scripts and packages are powerful")).toBeTruthy()
    expect(ONBOARDING_STEPS).toHaveLength(3)
  })

  it("cannot be dismissed: there is no close button and no backdrop", () => {
    render(<Harness />)

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull()
    expect(document.querySelector(".sheet-backdrop")).toBeNull()
    expect(document.querySelector(".onboarding")).toBeTruthy()
  })

  it("requires the trust acknowledgement before finishing", () => {
    const onFinish = vi.fn()
    render(
      <Onboarding open step={2} onStep={vi.fn()} onFinish={onFinish} />
    )

    const start = screen.getByRole("button", { name: "Start coding" }) as HTMLButtonElement
    expect(start.disabled).toBe(true)

    fireEvent.click(start)
    expect(onFinish).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole("checkbox"))
    expect(start.disabled).toBe(false)
    fireEvent.click(start)
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it("remembers the acknowledgement only for this install", () => {
    expect(hasSeenOnboarding()).toBe(false)

    markOnboardingSeen()
    expect(hasSeenOnboarding()).toBe(true)

    resetOnboarding()
    expect(hasSeenOnboarding()).toBe(false)
  })
})
