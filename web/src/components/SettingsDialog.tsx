import { useState } from "react"
import type { ReactNode } from "react"
import type { StorageInfo } from "../bridge"
import { FONT_FAMILIES, type UserSettings } from "../settings/userSettings"
import {
  EDITOR_THEMES,
  type EditorThemeId
} from "./editorThemes"
import {
  CpuIcon,
  GitIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  ShieldIcon,
  SmartphoneIcon,
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
  /** Shared-storage status, so the permission can be granted from Settings (W-27). */
  storage?: StorageInfo | null
  onRequestStoragePermission?: () => void
  /** Task 14: folder import and zip backup/restore. */
  onImportFolder?: () => void
  onExportBackup?: () => void
  onRestoreBackup?: () => void
  backupBusy?: boolean
  backupStatus?: string | null
  /** Phase F: open the Git/SSH sheets from Settings. */
  onOpenSshKeys?: () => void
  onOpenRemotes?: () => void
  /** Task 27: redacted support report and the first-run screens. */
  onOpenDiagnostics?: () => void
  onShowOnboarding?: () => void
  /** Task 28: signed update check card, wired to the update store. */
  updatesCard?: ReactNode
  /** Phase E (Task 17): Root mode state and actions */
  rootAvailable?: boolean
  rootEnabled?: boolean
  rootLoading?: boolean
  onRequestRoot?: () => void
  onDisableRoot?: () => void
}

export function SettingsDialog({
  open,
  onClose,
  settings,
  onUpdate,
  bridgeMode,
  version,
  onOpenRuntimes,
  storage,
  onRequestStoragePermission,
  onImportFolder,
  onExportBackup,
  onRestoreBackup,
  backupBusy = false,
  backupStatus = null,
  onOpenSshKeys,
  onOpenRemotes,
  onOpenDiagnostics,
  onShowOnboarding,
  updatesCard,
  rootAvailable = false,
  rootEnabled = false,
  rootLoading = false,
  onRequestRoot,
  onDisableRoot
}: Props) {
  const [activeTab, setActiveTab] = useState<"editor" | "appearance" | "git" | "about" | "advanced">("editor")

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
            className={"settings-nav-btn" + (activeTab === "git" ? " active" : "")}
            onClick={() => setActiveTab("git")}
          >
            <GitIcon size={16} />
            <span>Git</span>
          </button>
          <button
            className={"settings-nav-btn" + (activeTab === "about" ? " active" : "")}
            onClick={() => setActiveTab("about")}
          >
            <CpuIcon size={16} />
            <span>About</span>
          </button>
          <button
            className={"settings-nav-btn" + (activeTab === "advanced" ? " active" : "")}
            onClick={() => setActiveTab("advanced")}
          >
            <ShieldIcon size={16} />
            <span>Advanced</span>
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

        {activeTab === "git" && (
          <div className="settings-panel">
            <div className="settings-card">
              <label className="settings-card-label">Commit identity</label>
              <p className="guide-intro">
                Used for new commits. Leave both empty to let the host fall back to the
                repository configuration.
              </p>
              <label className="git-field">
                <span>Name</span>
                <input
                  value={settings.gitName}
                  placeholder="Your name"
                  onChange={(event) => onUpdate({ gitName: event.target.value })}
                />
              </label>
              <label className="git-field">
                <span>Email</span>
                <input
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={settings.gitEmail}
                  placeholder="you@example.com"
                  onChange={(event) => onUpdate({ gitEmail: event.target.value })}
                />
              </label>
            </div>

            <div className="settings-card">
              <label className="settings-card-label">Remotes and credentials</label>
              <p className="guide-intro">
                A token is sealed with the device keystore and is never shown again.
                SSH private keys stay in the keystore; only the public key leaves it.
              </p>
              {onOpenRemotes && (
                <button className="btn ghost full-width" onClick={onOpenRemotes}>
                  <GitIcon size={18} />
                  <span>Manage remotes</span>
                </button>
              )}
              {onOpenSshKeys && (
                <button className="btn ghost full-width" onClick={onOpenSshKeys}>
                  <span>Manage SSH keys and known hosts</span>
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === "about" && (
          <div className="settings-panel">
            {updatesCard}

            <div className="settings-card">
              <label className="settings-card-label">Shared storage</label>
              <p className="guide-intro">
                {storage === null || storage === undefined
                  ? "Storage access has not been checked yet."
                  : storage.hasPermission
                    ? "LeoCode can read and write shared storage (Downloads, Documents, SD cards)."
                    : "LeoCode cannot read shared storage yet. Grant access to open Downloads, Documents and bookmarks outside the app workspace."}
              </p>
              {onRequestStoragePermission && (
                <button
                  className="btn primary full-width"
                  onClick={onRequestStoragePermission}
                  disabled={Boolean(storage?.hasPermission)}
                >
                  <SmartphoneIcon size={18} />
                  <span>{storage?.hasPermission ? "Storage access granted" : "Grant storage access"}</span>
                </button>
              )}
            </div>

            <div className="settings-card">
              <label className="settings-card-label">Backup & Import</label>
              <p className="guide-intro">
                A backup is a zip of the active workspace. Restoring merges the archive
                into it; existing files with the same name are replaced. Import copies a
                folder from the system picker without overwriting existing names.
              </p>
              <div className="settings-backup-actions">
                <button className="btn ghost full-width" onClick={onImportFolder} disabled={backupBusy}>
                  <span>Import folder…</span>
                </button>
                <button className="btn ghost full-width" onClick={onExportBackup} disabled={backupBusy}>
                  <span>Export workspace backup…</span>
                </button>
                <button
                  className="btn ghost full-width danger"
                  onClick={onRestoreBackup}
                  disabled={backupBusy}
                >
                  <span>Restore from backup…</span>
                </button>
              </div>
              {backupStatus && <p className="guide-intro">{backupStatus}</p>}
            </div>

            <div className="settings-card">
              <label className="settings-card-label">Before uninstalling</label>
              <p className="guide-intro">
                Uninstalling LeoCode deletes app-private files, including every workspace,
                draft and backup kept inside the app. Export a workspace backup to
                Downloads or another provider first; Android does not keep app storage
                when the package is removed.
              </p>
            </div>

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
              <label className="settings-card-label">Diagnostics</label>
              <p className="guide-intro">
                Device, WebView, storage, runtimes and recent errors, with paths and
                credentials removed. Copy it for a bug report or share it with your device's
                share sheet.
              </p>
              {onOpenDiagnostics && (
                <button className="btn primary full-width" onClick={onOpenDiagnostics}>
                  <span>Open diagnostics</span>
                </button>
              )}
              {onShowOnboarding && (
                <button className="btn ghost full-width" onClick={onShowOnboarding}>
                  <span>Show onboarding again</span>
                </button>
              )}
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

            <div className="settings-card">
              <label className="settings-card-label">Background survival</label>
              <p className="guide-intro">
                A notification reports running terminals and jobs, with a{" "}
                <strong>Stop all</strong> action. Some vendors still kill background
                processes aggressively.
              </p>
              <ul className="guide">
                <li>
                  <strong>MIUI / HyperOS:</strong> Settings → Apps → LeoCode → Autostart
                  on; Battery saver → No restrictions.
                </li>
                <li>
                  <strong>Android 12+ phantom-process killer:</strong> Settings →
                  Developer options → Disable child process restrictions. Some builds
                  call it “Don't keep activities” nearby; leave that off.
                </li>
                <li>
                  <strong>Rooted phones:</strong> keep more background children with
                  <code>device_config put activity_manager max_phantom_processes 2147483647</code>
                  (reverts on reboot).
                </li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === "advanced" && (
          <div className="settings-panel">
            <div
              className="settings-card"
              style={{ cursor: rootAvailable && !rootLoading ? "pointer" : "default" }}
              onClick={() => {
                if (!rootAvailable || rootLoading) return
                if (!rootEnabled) {
                  onRequestRoot?.()
                } else {
                  onDisableRoot?.()
                }
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <label className="settings-card-label" style={{ marginBottom: 4, cursor: "inherit" }}>Root Mode</label>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--color-fg-muted)" }}>
                    {rootAvailable
                      ? "Execute terminal sessions and run processes as superuser (root / UID 0)."
                      : "Root is not available on this device."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={rootEnabled}
                  aria-label="Root Mode"
                  disabled={!rootAvailable || rootLoading}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!rootEnabled) {
                      onRequestRoot?.()
                    } else {
                      onDisableRoot?.()
                    }
                  }}
                  style={{
                    position: "relative",
                    width: 48,
                    height: 28,
                    borderRadius: 14,
                    border: "none",
                    background: rootEnabled ? "var(--color-danger, #ef4444)" : "var(--color-bg-subtle, #333)",
                    cursor: (!rootAvailable || rootLoading) ? "not-allowed" : "pointer",
                    padding: 2,
                    transition: "background 0.2s ease",
                    flexShrink: 0,
                    outline: "none"
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      background: "#fff",
                      transform: rootEnabled ? "translateX(20px)" : "translateX(0)",
                      transition: "transform 0.2s ease",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.3)"
                    }}
                  />
                </button>
              </div>
              {rootEnabled && (
                <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(239, 68, 68, 0.1)", border: "1px solid var(--color-danger, #ef4444)", borderRadius: 6, display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--color-danger, #ef4444)", letterSpacing: 0.5 }}>ROOT ACTIVE</span>
                  <span style={{ fontSize: 12, color: "var(--color-fg-muted)" }}>Terminal sessions and processes can execute as root.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
