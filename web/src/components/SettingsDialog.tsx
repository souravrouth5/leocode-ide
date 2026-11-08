import { useState } from "react"
import {
  FONT_FAMILIES,
  FONT_SIZES,
  type UserSettings
} from "../settings/userSettings"
import {
  EDITOR_THEMES,
  type EditorThemeId
} from "./editorThemes"
import {
  CpuIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  SunIcon,
  TypeIcon
} from "./Icons"
import { Sheet } from "./Sheet"

interface Props {
  open: boolean
  onClose: () => void
  settings: UserSettings
  onUpdate: (patch: Partial<UserSettings>) => void
  bridgeMode: string
  version: string
  onOpenRuntimes: () => void
}

export function SettingsDialog({
  open,
  onClose,
  settings,
  onUpdate,
  bridgeMode,
  version,
  onOpenRuntimes
}: Props) {
  const [activeTab, setActiveTab] = useState<"editor" | "appearance" | "about">("editor")

  const changeFontSize = (delta: number) => {
    const current = settings.fontSize
    const next = Math.max(11, Math.min(22, current + delta))
    onUpdate({ fontSize: next })
  }

  const changeTerminalFontSize = (delta: number) => {
    const current = settings.terminalFontSize
    const next = Math.max(10, Math.min(20, current + delta))
    onUpdate({ terminalFontSize: next })
  }

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="settings-container">
        <div className="settings-nav-tabs">
          <button
            className={"settings-nav-btn" + (activeTab === "editor" ? " active" : "")}
            onClick={() => setActiveTab("editor")}
          >
            <TypeIcon size={16} />
            <span>Editor</span>
          </button>
          <button
            className={"settings-nav-btn" + (activeTab === "appearance" ? " active" : "")}
            onClick={() => setActiveTab("appearance")}
          >
            <PaletteIcon size={16} />
            <span>Appearance</span>
          </button>
          <button
            className={"settings-nav-btn" + (activeTab === "about" ? " active" : "")}
            onClick={() => setActiveTab("about")}
          >
            <CpuIcon size={16} />
            <span>Environment</span>
          </button>
        </div>

        {activeTab === "editor" && (
          <div className="settings-panel">
            {/* Font Family */}
            <div className="settings-card">
              <label className="settings-card-label">Font Family</label>
              <div className="settings-options-grid">
                {FONT_FAMILIES.map((font) => (
                  <button
                    key={font.id}
                    className={
                      "settings-chip" +
                      (settings.fontFamily === font.value ? " selected" : "")
                    }
                    onClick={() => onUpdate({ fontFamily: font.value })}
                  >
                    <span style={{ fontFamily: font.value }}>{font.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size */}
            <div className="settings-card">
              <div className="settings-card-row">
                <label className="settings-card-label">Font Size</label>
                <div className="settings-stepper">
                  <button
                    className="stepper-btn"
                    onClick={() => changeFontSize(-1)}
                    disabled={settings.fontSize <= 11}
                    aria-label="Decrease font size"
                  >
                    -
                  </button>
                  <span className="stepper-value">{settings.fontSize}px</span>
                  <button
                    className="stepper-btn"
                    onClick={() => changeFontSize(1)}
                    disabled={settings.fontSize >= 22}
                    aria-label="Increase font size"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Preview */}
              <div
                className="settings-font-preview"
                style={{
                  fontFamily: settings.fontFamily,
                  fontSize: `${settings.fontSize}px`
                }}
              >
                <code>{"const hello = () => 'LeoCode IDE';"}</code>
              </div>
            </div>

            {/* Editor Theme */}
            <div className="settings-card">
              <label className="settings-card-label">Editor Syntax Theme</label>
              <div className="settings-options-grid themes-grid">
                {EDITOR_THEMES.map((theme) => (
                  <button
                    key={theme.id}
                    className={
                      "settings-chip theme-chip" +
                      (settings.editorTheme === theme.id ? " selected" : "")
                    }
                    onClick={() => onUpdate({ editorTheme: theme.id as EditorThemeId })}
                  >
                    <span className="theme-chip-dot" data-theme-id={theme.id} />
                    <span>{theme.name}</span>
                    <span className="theme-badge">{theme.dark ? "Dark" : "Light"}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Formatting & Behavior */}
            <div className="settings-card">
              <label className="settings-card-label">Editor Behavior</label>

              <div className="settings-toggle-row">
                <span>Tab Size</span>
                <div className="settings-segmented">
                  <button
                    className={"seg-btn" + (settings.tabSize === 2 ? " active" : "")}
                    onClick={() => onUpdate({ tabSize: 2 })}
                  >
                    2 spaces
                  </button>
                  <button
                    className={"seg-btn" + (settings.tabSize === 4 ? " active" : "")}
                    onClick={() => onUpdate({ tabSize: 4 })}
                  >
                    4 spaces
                  </button>
                </div>
              </div>

              <div className="settings-toggle-row">
                <span>Word Wrap</span>
                <button
                  className={"switch" + (settings.wordWrap ? " on" : "")}
                  onClick={() => onUpdate({ wordWrap: !settings.wordWrap })}
                  aria-label="Toggle word wrap"
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="settings-toggle-row">
                <span>Line Numbers</span>
                <button
                  className={"switch" + (settings.lineNumbers ? " on" : "")}
                  onClick={() => onUpdate({ lineNumbers: !settings.lineNumbers })}
                  aria-label="Toggle line numbers"
                >
                  <span className="switch-thumb" />
                </button>
              </div>

              <div className="settings-toggle-row">
                <span>Format on Save</span>
                <button
                  className={"switch" + (settings.formatOnSave ? " on" : "")}
                  onClick={() => onUpdate({ formatOnSave: !settings.formatOnSave })}
                  aria-label="Toggle format on save"
                >
                  <span className="switch-thumb" />
                </button>
              </div>
            </div>

            {/* Terminal */}
            <div className="settings-card">
              <div className="settings-card-row">
                <label className="settings-card-label">Terminal Font Size</label>
                <div className="settings-stepper">
                  <button
                    className="stepper-btn"
                    onClick={() => changeTerminalFontSize(-1)}
                    disabled={settings.terminalFontSize <= 10}
                  >
                    -
                  </button>
                  <span className="stepper-value">{settings.terminalFontSize}px</span>
                  <button
                    className="stepper-btn"
                    onClick={() => changeTerminalFontSize(1)}
                    disabled={settings.terminalFontSize >= 20}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "appearance" && (
          <div className="settings-panel">
            <div className="settings-card">
              <label className="settings-card-label">App Interface Theme</label>
              {(
                [
                  { id: "system", label: "Follow system theme", Icon: MonitorIcon },
                  { id: "light", label: "Light theme", Icon: SunIcon },
                  { id: "dark", label: "Dark theme", Icon: MoonIcon }
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  className={"choice" + (settings.appTheme === id ? " selected" : "")}
                  onClick={() => onUpdate({ appTheme: id })}
                >
                  <Icon size={18} />
                  <span>{label}</span>
                  <span className="choice-check">
                    {settings.appTheme === id ? "✓" : ""}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === "about" && (
          <div className="settings-panel">
            <div className="settings-card">
              <label className="settings-card-label">Runtime Toolchains</label>
              <button
                className="btn primary full-width"
                onClick={() => {
                  onClose()
                  onOpenRuntimes()
                }}
              >
                <CpuIcon size={18} />
                <span>Open Runtime & Environment Manager</span>
              </button>
            </div>

            <div className="settings-card">
              <label className="settings-card-label">System Facts</label>
              <dl className="facts">
                <dt>Bridge</dt>
                <dd>{bridgeMode}</dd>
                <dt>Version</dt>
                <dd>{version}</dd>
                <dt>Target SDK</dt>
                <dd>28 (Unrooted Process Exec)</dd>
              </dl>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
