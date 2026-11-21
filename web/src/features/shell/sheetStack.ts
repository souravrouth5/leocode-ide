/**
 * Small registry of open sheets/dialogs, so the Android back button can close
 * the topmost one instead of leaving the activity (W-12).
 *
 * Global sheets (error sheet, run sheet, prompt, settings) are owned by their
 * stores; this stack is for local UI sheets that live in component state, such
 * as the FileTree action sheets and the app-bar menus.
 */
export interface SheetStackEntry {
  /** Unique per mounted sheet; re-registering the same id replaces the old one. */
  id: string
  close: () => void
  /** Higher priority closes first; ties close newest-first (LIFO). */
  priority?: number
}

export interface SheetStack {
  register(entry: SheetStackEntry): () => void
  /** Close the topmost sheet. Returns false when nothing is registered. */
  dismissTop(): boolean
  has(id: string): boolean
  size(): number
  /** Registered ids, topmost first. */
  ids(): string[]
  clear(): void
}

interface Entry {
  entry: SheetStackEntry
  order: number
}

export function createSheetStack(): SheetStack {
  let items: Entry[] = []
  let order = 0
  const unregisters = new Map<string, () => void>()

  const indexOf = (id: string) => items.findIndex((item) => item.entry.id === id)

  return {
    register(entry) {
      // A second open with the same id must not leave two closers behind.
      unregisters.get(entry.id)?.()
      const item: Entry = { entry, order: ++order }
      items = [...items, item]
      const unregister = () => {
        items = items.filter((candidate) => candidate !== item)
        unregisters.delete(entry.id)
      }
      unregisters.set(entry.id, unregister)
      return unregister
    },

    dismissTop() {
      if (items.length === 0) return false
      let top = items[0]
      for (const item of items) {
        const priority = item.entry.priority ?? 0
        const topPriority = top.entry.priority ?? 0
        if (priority > topPriority || (priority === topPriority && item.order > top.order)) {
          top = item
        }
      }
      const unregister = unregisters.get(top.entry.id)
      unregister?.()
      top.entry.close()
      return true
    },

    has(id) {
      return indexOf(id) !== -1
    },

    size() {
      return items.length
    },

    ids() {
      return [...items]
        .sort((a, b) =>
          (b.entry.priority ?? 0) - (a.entry.priority ?? 0) || b.order - a.order
        )
        .map((item) => item.entry.id)
    },

    clear() {
      items = []
      unregisters.clear()
    }
  }
}
