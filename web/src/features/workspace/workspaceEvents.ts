/**
 * Fired after the active workspace actually changed (PD-14). Volatile view
 * state (search results, find/replace terms) listens for it and resets, because
 * the paths it holds are relative to the old root.
 */
export const WORKSPACE_SWITCHED_EVENT = "leocode:workspace-switched"

export interface WorkspaceSwitchedDetail {
  /** The workspace that is active after the switch. */
  id: string
}

export function dispatchWorkspaceSwitched(id: string): void {
  window.dispatchEvent(
    new CustomEvent<WorkspaceSwitchedDetail>(WORKSPACE_SWITCHED_EVENT, { detail: { id } })
  )
}
