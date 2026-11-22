/**
 * First-run onboarding marker (Task 27).
 *
 * The flag lives in localStorage, not the workspace: it is about this install,
 * and it must survive switching projects. Clearing app data (or uninstalling)
 * resets it, which is exactly the fresh-install behaviour the demo needs.
 */
const KEY = "leocode.onboarding.v1"

export function hasSeenOnboarding(): boolean {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    // Storage blocked: show the screens rather than silently skipping them.
    return false
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(KEY, "1")
  } catch {
    // The app still works; the screens will show again next launch.
  }
}

export function resetOnboarding(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing else to do.
  }
}
