// @ts-expect-error Node module available in Vitest test runner
import fs from "fs"
// @ts-expect-error Node module available in Vitest test runner
import path from "path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { BottomNav } from "../layout/BottomNav"
import { ActionSheet, Sheet } from "../../components/Sheet"
import { PromptDialog } from "../../components/PromptDialog"
import { DialogHost } from "../dialogs/DialogHost"
import { Onboarding } from "../onboarding/Onboarding"
import { createAppStores, StoresProvider } from "../../app/stores"
import { MockBridge } from "../../bridge/mock"

// @ts-expect-error __dirname injected by test runner
const currentDir: string = typeof __dirname !== "undefined" ? __dirname : "."

afterEach(cleanup)

// Helper to compute WCAG 2.1 relative luminance and contrast ratio
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim()
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16)
    const g = parseInt(clean[1] + clean[1], 16)
    const b = parseInt(clean[2] + clean[2], 16)
    return [r, g, b]
  }
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return [r, g, b]
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [rs, gs, bs] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hexToRgb(hex1))
  const l2 = relativeLuminance(hexToRgb(hex2))
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

describe("Accessibility Audit (Task 29)", () => {
  describe("1. Touch target sizes and ergonomic spacing", () => {
    const stylesDir = path.resolve(currentDir, "../../styles")
    const tabsCss = fs.readFileSync(path.join(stylesDir, "tabs.css"), "utf-8")
    const buttonsCss = fs.readFileSync(path.join(stylesDir, "buttons.css"), "utf-8")
    const keysCss = fs.readFileSync(path.join(stylesDir, "keys.css"), "utf-8")

    it("enforces minimum 48dp target height for bottom navigation tabs", () => {
      // Android accessibility guidelines specify 48x48 dp minimum interactive target
      const tabItemMatch = tabsCss.match(/\.tabbar-item\s*\{[^}]*height:\s*([0-9]+)px/)
      expect(tabItemMatch).toBeTruthy()
      const height = parseInt(tabItemMatch![1], 10)
      expect(height).toBeGreaterThanOrEqual(48)
      expect(height).toBe(52) // LeoCode tabbar height is 52px
    })

    it("enforces touch-friendly heights and padding for standard buttons", () => {
      // Standard buttons must have comfortable touch height and horizontal padding
      const btnMatch = buttonsCss.match(/\.btn\s*\{[^}]*min-height:\s*([0-9]+)px/)
      expect(btnMatch).toBeTruthy()
      const minHeight = parseInt(btnMatch![1], 10)
      expect(minHeight).toBeGreaterThanOrEqual(40)

      const paddingMatch = buttonsCss.match(/\.btn\s*\{[^}]*padding:\s*0\s+([0-9]+)px/)
      expect(paddingMatch).toBeTruthy()
      const padding = parseInt(paddingMatch![1], 10)
      expect(padding).toBeGreaterThanOrEqual(14)
    })

    it("enforces touch target dimensions for keyboard accessory row buttons", () => {
      // Key row buttons for virtual keyboard typing (min-width >= 40px, height >= 36px)
      const minWidthMatch = keysCss.match(/\.key-row\s+button\s*\{[^}]*min-width:\s*([0-9]+)px/)
      expect(minWidthMatch).toBeTruthy()
      const minWidth = parseInt(minWidthMatch![1], 10)
      expect(minWidth).toBeGreaterThanOrEqual(40)

      const heightMatch = keysCss.match(/\.key-row\s+button\s*\{[^}]*height:\s*([0-9]+)px/)
      expect(heightMatch).toBeTruthy()
      const height = parseInt(heightMatch![1], 10)
      expect(height).toBeGreaterThanOrEqual(36)
    })

    it("renders BottomNav tabs with interactive target classes", () => {
      const stores = createAppStores(new MockBridge())
      render(
        <StoresProvider stores={stores}>
          <BottomNav />
        </StoresProvider>
      )

      const buttons = screen.getAllByRole("button")
      expect(buttons).toHaveLength(5)
      for (const btn of buttons) {
        expect(btn.className).toContain("tabbar-item")
      }
    })
  })

  describe("2. Screen reader attributes and semantic labeling", () => {
    it("provides accessible navigation landmark and labels for BottomNav", () => {
      const stores = createAppStores(new MockBridge())
      render(
        <StoresProvider stores={stores}>
          <BottomNav />
        </StoresProvider>
      )

      // Navigation landmark
      const nav = screen.getByRole("navigation", { name: "Main" })
      expect(nav).toBeTruthy()

      // Tab labels
      expect(screen.getByRole("button", { name: /Explorer/i })).toBeTruthy()
      expect(screen.getByRole("button", { name: /Editor/i })).toBeTruthy()
      expect(screen.getByRole("button", { name: /Git/i })).toBeTruthy()
      expect(screen.getByRole("button", { name: /Terminal/i })).toBeTruthy()
      expect(screen.getByRole("button", { name: /Runtimes/i })).toBeTruthy()
    })

    it("marks active view with aria-current in BottomNav", () => {
      const stores = createAppStores(new MockBridge())
      stores.shell.getState().go("terminal")
      render(
        <StoresProvider stores={stores}>
          <BottomNav />
        </StoresProvider>
      )

      const terminalTab = screen.getByRole("button", { name: /Terminal/i })
      expect(terminalTab.getAttribute("aria-current")).toBe("page")

      const editorTab = screen.getByRole("button", { name: /Editor/i })
      expect(editorTab.getAttribute("aria-current")).toBeNull()
    })

    it("labels Sheet close button and modal dialog container", () => {
      render(
        <Sheet open title="Git Remotes" onClose={vi.fn()}>
          <div>Sheet content</div>
        </Sheet>
      )

      const dialog = screen.getByRole("dialog", { name: "Git Remotes" })
      expect(dialog).toBeTruthy()
      expect(dialog.getAttribute("aria-modal")).toBe("true")

      const closeButton = screen.getByRole("button", { name: "Close" })
      expect(closeButton).toBeTruthy()
      expect(closeButton.getAttribute("aria-label")).toBe("Close")
    })

    it("ensures ActionSheet actions have clear accessible text names", () => {
      const actions = [
        { label: "Pull changes", onSelect: vi.fn() },
        { label: "Push commits", onSelect: vi.fn() },
        { label: "Discard changes", destructive: true, onSelect: vi.fn() }
      ]

      render(
        <ActionSheet
          open
          title="Git Operations"
          actions={actions}
          onClose={vi.fn()}
        />
      )

      expect(screen.getByRole("dialog", { name: "Git Operations" })).toBeTruthy()
      for (const action of actions) {
        const btn = screen.getByRole("button", { name: action.label })
        expect(btn).toBeTruthy()
        expect(btn.textContent).toContain(action.label)
      }
    })

    it("connects label and error alerts in PromptDialog via htmlFor and aria-describedby", async () => {
      render(
        <PromptDialog
          open
          title="New Branch"
          label="Branch name:"
          initialValue=""
          confirmLabel="Create branch"
          onConfirm={vi.fn()}
          onClose={vi.fn()}
        />
      )

      const input = screen.getByLabelText("Branch name:")
      expect(input).toBeTruthy()
      expect(input.id).toBe("prompt-input")

      // Trigger validation error by submitting empty input through the form
      fireEvent.change(input, { target: { value: "   " } })
      fireEvent.submit(input.closest("form")!)

      // Alert role for screen reader announcement
      await waitFor(() => {
        const alert = screen.getByRole("alert")
        expect(alert).toBeTruthy()
        expect(alert.textContent).toBe("Enter a value.")
      })
      expect(input.getAttribute("aria-invalid")).toBe("true")
      expect(input.getAttribute("aria-describedby")).toBe("prompt-error")
    })

    it("presents accessible dialog semantics in DialogHost for confirm and prompt", async () => {
      const stores = createAppStores(new MockBridge())
      render(
        <StoresProvider stores={stores}>
          <DialogHost />
        </StoresProvider>
      )

      // Open confirm
      void stores.dialogs.getState().confirm({
        title: "Delete file?",
        message: "Are you sure you want to delete test.py?",
        confirmLabel: "Delete",
        danger: true
      })

      await waitFor(() => {
        expect(screen.getByRole("dialog", { name: "Delete file?" })).toBeTruthy()
      })
      expect(screen.getByText("Are you sure you want to delete test.py?")).toBeTruthy()

      const okBtn = screen.getByRole("button", { name: "Delete" })
      const cancelBtn = screen.getByRole("button", { name: "Cancel" })
      expect(okBtn).toBeTruthy()
      expect(cancelBtn).toBeTruthy()
    })

    it("verifies Onboarding dialog semantics and navigation controls", () => {
      render(
        <Onboarding
          open
          step={0}
          onStep={vi.fn()}
          onFinish={vi.fn()}
        />
      )

      const dialog = screen.getByRole("dialog", { name: "Welcome to LeoCode" })
      expect(dialog).toBeTruthy()
      expect(screen.getByRole("button", { name: "Next" })).toBeTruthy()
    })
  })

  describe("3. Dialog and Sheet keyboard escape handling", () => {
    it("dismisses Sheet on Escape key", () => {
      const onClose = vi.fn()
      render(
        <Sheet open title="Keyboard Test" onClose={onClose}>
          <div>Body</div>
        </Sheet>
      )

      fireEvent.keyDown(window, { key: "Escape" })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("dismisses ActionSheet on Escape key", () => {
      const onClose = vi.fn()
      render(
        <ActionSheet
          open
          title="Actions Test"
          actions={[{ label: "Action 1", onSelect: vi.fn() }]}
          onClose={onClose}
        />
      )

      fireEvent.keyDown(window, { key: "Escape" })
      expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("marks closed sheets as aria-hidden for assistive technology", () => {
      render(
        <Sheet open={false} title="Hidden Sheet" onClose={vi.fn()}>
          <div>Hidden Content</div>
        </Sheet>
      )

      const sheetSection = document.querySelector(".sheet")
      expect(sheetSection).toBeTruthy()
      expect(sheetSection?.getAttribute("aria-hidden")).toBe("true")
      expect(sheetSection?.classList.contains("is-open")).toBe(false)
    })
  })

  describe("4. Theme readability and WCAG contrast token verification", () => {
    const tokensCss = fs.readFileSync(
      path.resolve(currentDir, "../../styles/tokens.css"),
      "utf-8"
    )

    // Token extraction helper
    const extractToken = (blockRegex: RegExp, varName: string): string => {
      const blockMatch = tokensCss.match(blockRegex)
      if (!blockMatch) throw new Error(`Block not found for ${varName}`)
      const varRegex = new RegExp(`${varName}:\\s*(#[0-9a-fA-F]{3,8})`)
      const match = blockMatch[0].match(varRegex)
      if (!match) throw new Error(`Token ${varName} not found`)
      return match[1]
    }

    const darkBlock = /:root\s*,[\s\S]*?:root\[data-theme="dark"\]\s*\{[^}]+\}/
    const lightBlock = /:root\[data-theme="light"\]\s*\{[^}]+\}/

    it("satisfies WCAG AAA contrast ratio (>= 7:1) for primary text in dark theme", () => {
      const bg = extractToken(darkBlock, "--bg")
      const text = extractToken(darkBlock, "--text")
      const ratio = contrastRatio(text, bg)

      // #e6e9ef on #0f1115
      expect(ratio).toBeGreaterThanOrEqual(7.0)
    })

    it("satisfies WCAG AA contrast ratio (>= 4.5:1) for secondary text in dark theme", () => {
      const bg = extractToken(darkBlock, "--bg")
      const textDim = extractToken(darkBlock, "--text-dim")
      const ratio = contrastRatio(textDim, bg)

      // #b9c0cc on #0f1115
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it("satisfies WCAG AAA contrast ratio (>= 7:1) for primary text in light theme", () => {
      const bg = extractToken(lightBlock, "--bg")
      const text = extractToken(lightBlock, "--text")
      const ratio = contrastRatio(text, bg)

      // #1b2028 on #f7f8fa
      expect(ratio).toBeGreaterThanOrEqual(7.0)
    })

    it("satisfies WCAG AA contrast ratio (>= 4.5:1) for secondary text in light theme", () => {
      const bg = extractToken(lightBlock, "--bg")
      const textDim = extractToken(lightBlock, "--text-dim")
      const ratio = contrastRatio(textDim, bg)

      // #3f4753 on #f7f8fa
      expect(ratio).toBeGreaterThanOrEqual(4.5)
    })

    it("satisfies UI component contrast ratio (>= 3:1) for accent interactive colors", () => {
      const darkBg = extractToken(darkBlock, "--bg")
      const darkAccent = extractToken(darkBlock, "--accent")
      expect(contrastRatio(darkAccent, darkBg)).toBeGreaterThanOrEqual(3.0)

      const lightBg = extractToken(lightBlock, "--bg")
      const lightAccent = extractToken(lightBlock, "--accent")
      expect(contrastRatio(lightAccent, lightBg)).toBeGreaterThanOrEqual(3.0)
    })
  })

  describe("5. 200% font zoom & container reflow readiness", () => {
    const sheetsCss = fs.readFileSync(
      path.resolve(currentDir, "../../styles/sheets.css"),
      "utf-8"
    )

    it("ensures sheet dialog bodies allow vertical scrolling without content truncation", () => {
      // Under 200% font scaling, dialogs must not clip text; .sheet-body must scroll
      expect(sheetsCss).toMatch(/\.sheet-body\s*\{[^}]*overflow-y:\s*auto/)
      expect(sheetsCss).toMatch(/\.sheet\s*\{[^}]*max-height:\s*86%/)
    })
  })
})
