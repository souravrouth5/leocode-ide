import { createContext, useContext, type ReactNode } from "react"
import type { StoreApi } from "zustand/vanilla"
import type { Bridge } from "../bridge"
import {
  createNotificationsStore,
  type NotificationsState
} from "../notifications/notificationsStore"
import { createErrorsStore, type ErrorsState } from "../errors/errorsStore"
import { createSettingsStore, type SettingsStore } from "../features/settings/settingsStore"
import { createShellStore, type ShellState } from "../features/shell/shellStore"
import { createFilesStore, type FilesState } from "../features/files/filesStore"
import { createEditorStore, type EditorStore } from "../features/editor/editorStore"
import { createRunStore, type RunStore } from "../features/run/runStore"
import { createPythonStore, type PythonState } from "../features/python/pythonStore"
import {
  createWorkspaceStore,
  type WorkspaceState
} from "../features/workspace/workspaceStore"
import {
  createSearchStore,
  type SearchState
} from "../features/search/searchStore"
import {
  createFindReplaceStore,
  type FindReplaceStore
} from "../features/editor/findReplaceStore"
import { createDialogStore, type DialogState } from "../features/dialogs/dialogStore"
import { createBackupStore, type BackupState } from "../features/workspace/backupStore"
import { createGitStore, type GitStore } from "../features/git/gitStore"
import { createUpdateStore, type UpdateState } from "../features/update/updateStore"

export interface AppStores {
  bridge: Bridge
  notifications: StoreApi<NotificationsState>
  errors: StoreApi<ErrorsState>
  settings: SettingsStore
  shell: StoreApi<ShellState>
  files: StoreApi<FilesState>
  editor: EditorStore
  /** Per-project venv, requirements and trust decisions (Task 26). */
  python: StoreApi<PythonState>
  run: RunStore
  workspace: StoreApi<WorkspaceState>
  search: StoreApi<SearchState>
  findReplace: FindReplaceStore
  dialogs: StoreApi<DialogState>
  /** Import/export/restore progress, shown outside the Settings sheet (PD-25). */
  backup: StoreApi<BackupState>
  /** Git, SSH keys and host keys for the active workspace (Phase F). */
  git: GitStore
  /** Signed self-update check and installer hand-off (Task 28). */
  updates: StoreApi<UpdateState>
  /** Remove listeners the stores installed on `window` (W-26). */
  dispose(): void
}

/**
 * Manual DI (D-015): every store is built once for the bridge and passed
 * explicitly. Stores never import each other's singletons, so tests can create
 * an isolated graph against a fake bridge.
 */
export function createAppStores(bridge: Bridge): AppStores {
  const notifications = createNotificationsStore()
  const errors = createErrorsStore((notice) => {
    notifications.getState().enqueue(notice)
  })
  const settings = createSettingsStore()
  const shell = createShellStore()
  const files = createFilesStore(bridge, errors)
  const dialogs = createDialogStore()
  // The editor store persists which workspace its tabs belong to (PD-11). The
  // workspace store needs the editor, so the id is read lazily through this
  // forward reference instead of creating the stores in a cycle.
  let workspace: StoreApi<WorkspaceState> | null = null
  const editor = createEditorStore({
    bridge,
    files,
    settings,
    shell,
    errors,
    notifications,
    dialogs,
    workspaceId: () => workspace?.getState().activeId ?? null
  })
  const python = createPythonStore({ bridge, dialogs, notifications, errors })
  const run = createRunStore({ bridge, editor, notifications, python })
  workspace = createWorkspaceStore({
    bridge,
    files,
    editor,
    shell,
    notifications,
    errors,
    dialogs
  })
  const search = createSearchStore({
    bridge,
    editor,
    shell,
    notifications,
    errors
  })
  const findReplace = createFindReplaceStore()
  const backup = createBackupStore()
  const git = createGitStore({
    bridge,
    settings,
    notifications,
    errors,
    dialogs
  })
  const updates = createUpdateStore({ bridge, errors })

  let disposed = false
  return {
    bridge,
    notifications,
    errors,
    settings,
    shell,
    files,
    editor,
    python,
    run,
    workspace,
    search,
    findReplace,
    dialogs,
    backup,
    git,
    updates,
    dispose() {
      if (disposed) return
      disposed = true
      editor.dispose()
      run.dispose()
      settings.dispose()
      findReplace.dispose()
      git.dispose()
    }
  }
}

const StoresContext = createContext<AppStores | null>(null)

export function StoresProvider({
  stores,
  children
}: {
  stores: AppStores
  children: ReactNode
}) {
  return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>
}

export function useStores(): AppStores {
  const stores = useContext(StoresContext)
  if (!stores) throw new Error("useStores must be used inside StoresProvider")
  return stores
}
