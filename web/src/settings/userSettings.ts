import { useEffect, useState } from "react"
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

export const DEFAULT_SETTINGS: UserSettings = {
  appTheme: "system",
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 14,
  editorTheme: "tokyo-night",
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  formatOnSave: false,
  terminalFontSize: 13
}

const STORAGE_KEY = "leocode.user-settings"

export function loadSettings(): UserSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<UserSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
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

export function useUserSettings(): [UserSettings, (update: Partial<UserSettings>) => void] {
  const [settings, setSettings] = useState<UserSettings>(() => loadSettings())

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<UserSettings>
      if (custom.detail) {
        setSettings(custom.detail)
      } else {
        setSettings(loadSettings())
      }
    }
    window.addEventListener("leocode:settings-changed", handler)
    window.addEventListener("storage", handler)
    return () => {
      window.removeEventListener("leocode:settings-changed", handler)
      window.removeEventListener("storage", handler)
    }
  }, [])

  const update = (patch: Partial<UserSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveSettings(next)
  }

  return [settings, update]
}
