import { describe, expect, it, vi } from "vitest"
import { createSheetStack } from "./sheetStack"

describe("sheet stack (W-12)", () => {
  it("closes the newest sheet first", () => {
    const stack = createSheetStack()
    const first = vi.fn()
    const second = vi.fn()
    stack.register({ id: "actions", close: first })
    stack.register({ id: "sort", close: second })

    expect(stack.ids()).toEqual(["sort", "actions"])
    expect(stack.dismissTop()).toBe(true)
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(stack.dismissTop()).toBe(true)
    expect(first).toHaveBeenCalledTimes(1)
    expect(stack.dismissTop()).toBe(false)
  })

  it("closes a higher-priority sheet first even when it opened earlier", () => {
    const stack = createSheetStack()
    const menu = vi.fn()
    const dialog = vi.fn()
    stack.register({ id: "menu", close: menu, priority: 0 })
    stack.register({ id: "dialog", close: dialog, priority: 10 })

    stack.dismissTop()

    expect(dialog).toHaveBeenCalledTimes(1)
    expect(menu).not.toHaveBeenCalled()
  })

  it("unregisters when the sheet closes itself", () => {
    const stack = createSheetStack()
    const close = vi.fn()
    const unregister = stack.register({ id: "actions", close })

    unregister()
    expect(stack.size()).toBe(0)
    expect(stack.dismissTop()).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it("re-registering the same id does not leave two closers behind", () => {
    const stack = createSheetStack()
    const stale = vi.fn()
    const fresh = vi.fn()
    stack.register({ id: "actions", close: stale })
    stack.register({ id: "actions", close: fresh })

    expect(stack.size()).toBe(1)
    stack.dismissTop()
    expect(stale).not.toHaveBeenCalled()
    expect(fresh).toHaveBeenCalledTimes(1)
  })

  it("clears every entry", () => {
    const stack = createSheetStack()
    stack.register({ id: "a", close: vi.fn() })
    stack.register({ id: "b", close: vi.fn() })

    stack.clear()

    expect(stack.size()).toBe(0)
    expect(stack.has("a")).toBe(false)
  })
})
