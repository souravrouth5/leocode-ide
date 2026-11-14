import type { AppStores } from "../../app/stores"

/**
 * Android back button, in layer order (W-12):
 *
 * error sheet → error banner → local sheets (action sheets/menus) → drawer →
 * run sheet (hide, never cancel) → prompt/settings → non-editor view.
 *
 * Returning `false` lets the Activity leave, which only happens when nothing is
 * covering the editor.
 */
export function handleBack(stores: AppStores): boolean {
  const { errors, shell, run } = stores

  if (errors.getState().dismissTop()) return true
  if (shell.getState().dismissTopSheet()) return true

  if (shell.getState().sidebarOpen) {
    shell.getState().setSidebarOpen(false)
    return true
  }
  if (run.getState().sheetOpen) {
    // Hiding the run output must not kill the process it shows (W-12).
    run.getState().hide()
    return true
  }
  if (shell.getState().prompt || shell.getState().settingsOpen) {
    shell.getState().closePrompt()
    shell.getState().setSettingsOpen(false)
    return true
  }
  if (shell.getState().view !== "editor") {
    shell.getState().setView("editor")
    return true
  }
  return false
}
