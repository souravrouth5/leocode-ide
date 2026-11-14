import type { EditorThemeId } from "../components/editorThemes"

export interface UserSettings {
  // Appearance
  appTheme: "system" | "light" | "dark"

  // Editor Typography & Look
  fontFamily: string
  fontSize: number
  editorTheme: EditorThemeId

  // Editor Behavior
  tabSize: 2 | 4
  wordWrap: boolean
  lineNumbers: boolean
  formatOnSave: boolean
  resumeSession: boolean

  // Navigation & Bookmarks
  recentFiles: string[]
  bookmarks: string[]

  // File Explorer Filtering & Sorting
  showHiddenFiles: boolean
  filterBinaryFiles: boolean
  sortBy: "name-asc" | "name-desc" | "size-desc" | "size-asc" | "mtime-desc" | "mtime-asc" | "ext"

  // Terminal
  terminalFontSize: number
}

export const FONT_FAMILIES = [
  { id: "jetbrains-mono", label: "JetBrains Mono", value: "'JetBrains Mono', monospace" },
  { id: "fira-code", label: "Fira Code", value: "'Fira Code', monospace" },
  { id: "source-code-pro", label: "Source Code Pro", value: "'Source Code Pro', monospace" },
  { id: "roboto-mono", label: "Roboto Mono", value: "'Roboto Mono', monospace" },
  { id: "menlo-consolas", label: "Menlo / Consolas", value: "Menlo, Consolas, Monaco, monospace" },
  { id: "system-mono", label: "System Monospace", value: "ui-monospace, SFMono-Regular, monospace" }
]

export const FONT_SIZES = [11, 12, 13, 14, 15, 16, 18, 20]

const EDITOR_THEME_IDS: readonly string[] = [
  "tokyo-night",
  "one-dark",
  "dracula",
  "monokai",
  "github-light",
  "solarized-light"
]

export const SORT_MODES = [
  "name-asc",
  "name-desc",
  "size-desc",
  "size-asc",
  "mtime-desc",
  "mtime-asc",
  "ext"
] as const

export const DEFAULT_SETTINGS: UserSettings = {
  appTheme: "system",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 14,
  editorTheme: "tokyo-night",
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  formatOnSave: false,
  resumeSession: true,
  recentFiles: [],
  bookmarks: ["/storage/emulated/0/Download"],
  showHiddenFiles: false,
  filterBinaryFiles: true,
  sortBy: "name-asc",
  terminalFontSize: 13
}

const STORAGE_KEY = "leocode.user-settings"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stringList = (value: unknown, limit = 50): string[] | null => {
  if (!Array.isArray(value)) return null
  const items = value.filter((item): item is string => typeof item === "string" && item.length > 0)
  return items.slice(0, limit)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * Stored JSON is user-visible state that an older build or a hand edit can
 * corrupt: a string where an array is expected crashes the tree during render
 * (W-29/W-34). Every field is type-checked and falls back to its default.
 */
export function coerceSettings(input: unknown): UserSettings {
  if (!isRecord(input)) return DEFAULT_SETTINGS
  const base = DEFAULT_SETTINGS
  const next: UserSettings = { ...base }

  if (input.appTheme === "system" || input.appTheme === "light" || input.appTheme === "dark") {
    next.appTheme = input.appTheme
  }
  if (typeof input.fontFamily === "string" && input.fontFamily.trim()) {
    next.fontFamily = input.fontFamily
  }
  if (typeof input.fontSize === "number" && Number.isFinite(input.fontSize)) {
    next.fontSize = clamp(Math.round(input.fontSize), 9, 32)
  }
  if (typeof input.editorTheme === "string" && EDITOR_THEME_IDS.includes(input.editorTheme)) {
    next.editorTheme = input.editorTheme as EditorThemeId
  }
  if (input.tabSize === 2 || input.tabSize === 4) next.tabSize = input.tabSize
  for (const key of ["wordWrap", "lineNumbers", "formatOnSave", "resumeSession"] as const) {
    if (typeof input[key] === "boolean") next[key] = input[key] as boolean
  }
  const recent = stringList(input.recentFiles, 20)
  if (recent) next.recentFiles = recent
  const bookmarks = stringList(input.bookmarks)
  if (bookmarks) next.bookmarks = bookmarks
  if (typeof input.showHiddenFiles === "boolean") next.showHiddenFiles = input.showHiddenFiles
  if (typeof input.filterBinaryFiles === "boolean") {
    next.filterBinaryFiles = input.filterBinaryFiles
  }
  if (
    typeof input.sortBy === "string" &&
    (SORT_MODES as readonly string[]).includes(input.sortBy)
  ) {
    next.sortBy = input.sortBy as UserSettings["sortBy"]
  }
  if (typeof input.terminalFontSize === "number" && Number.isFinite(input.terminalFontSize)) {
    next.terminalFontSize = clamp(Math.round(input.terminalFontSize), 8, 28)
  }
  return next
}

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return coerceSettings(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: UserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    window.dispatchEvent(new CustomEvent("leocode:settings-changed", { detail: settings }))
  } catch {
    // quota exceeded or blocked
  }
}
