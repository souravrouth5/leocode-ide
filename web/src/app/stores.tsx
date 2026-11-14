import { createContext, useContext, type ReactNode } from "react"
import type { StoreApi } from "zustand/vanilla"
import type { Bridge } from "../bridge"
import {
  createNotificationsStore,
  type NotificationsState
} from "../notifications/notificationsStore"
import { createErrorsStore, type ErrorsState } from "../errors/errorsStore"
import { createSettingsStore, type SettingsState } from "../features/settings/settingsStore"
import { createShellStore, type ShellState } from "../features/shell/shellStore"
import { createFilesStore, type FilesState } from "../features/files/filesStore"
import { createEditorStore, type EditorState } from "../features/editor/editorStore"
import { createRunStore, type RunState } from "../features/run/runStore"

export interface AppStores {
  bridge: Bridge
  notifications: StoreApi<NotificationsState>
  errors: StoreApi<ErrorsState>
  settings: StoreApi<SettingsState>
  shell: StoreApi<ShellState>
  files: StoreApi<FilesState>
  editor: StoreApi<EditorState>
  run: StoreApi<RunState>
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
  const editor = createEditorStore({ bridge, files, settings, shell, errors, notifications })
  const run = createRunStore({ bridge, editor, notifications })

  return { bridge, notifications, errors, settings, shell, files, editor, run }
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
