import { createStore, type StoreApi } from "zustand/vanilla"
import type { Bridge, WorkspaceInfo } from "../../bridge"
import type { EditorStore } from "../editor/editorStore"
import type { FilesState } from "../files/filesStore"
import type { ShellState } from "../shell/shellStore"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { ErrorsState } from "../../errors/errorsStore"

export interface WorkspaceState {
  workspaces: WorkspaceInfo[]
  activeId: string | null
  loading: boolean
  /** A workspace operation is in flight; the switcher disables its buttons. */
  busy: boolean
  load(): Promise<void>
  create(name: string): Promise<boolean>
  open(id: string): Promise<boolean>
  rename(id: string, name: string): Promise<boolean>
  remove(id: string): Promise<boolean>
}

interface WorkspaceDeps {
  bridge: Bridge
  files: StoreApi<FilesState>
  editor: EditorStore
  shell: StoreApi<ShellState>
  notifications: StoreApi<NotificationsState>
  errors: StoreApi<ErrorsState>
}

/**
 * Multiple project workspaces (Task 14).
 *
 * The host owns the registry and the active workspace; this store mirrors it for
 * the switcher. Switching never closes tabs silently on a different root: the
 * editor gets a chance to reset, and the explorer re-lists from `.` under the new
 * workspace.
 */
export function createWorkspaceStore(deps: WorkspaceDeps): StoreApi<WorkspaceState> {
  const { bridge, files, editor, shell, notifications, errors } = deps

  return createStore<WorkspaceState>((set, get) => ({
    workspaces: [],
    activeId: null,
    loading: false,
    busy: false,

    async load() {
      set({ loading: true })
      try {
        const reply = await bridge.listWorkspaces()
        set({
          workspaces: reply.workspaces,
          activeId: reply.active,
          loading: false
        })
      } catch (error) {
        set({ loading: false })
        errors.getState().report(error, { context: "Load workspaces" })
      }
    },

    async create(name) {
      if (get().busy) return false
      set({ busy: true })
      try {
        const record = await bridge.createWorkspace(name)
        await get().load()
        notifications.getState().enqueue({
          kind: "success",
          message: `Workspace “${record.name}” created`,
          durationMs: 3_500
        })
        return true
      } catch (error) {
        errors.getState().report(error, { context: "Create workspace" })
        return false
      } finally {
        set({ busy: false })
      }
    },

    async open(id) {
      if (get().busy || id === get().activeId) return id === get().activeId
      set({ busy: true })
      try {
        const record = await bridge.openWorkspace(id)
        // The old relative paths are meaningless under the new root.
        editor.getState().clearWorkspace()
        await files.getState().refresh(".")
        set({ activeId: record.id })
        shell.getState().go("files")
        shell.getState().flash(`Workspace: ${record.name}`)
        await get().load()
        return true
      } catch (error) {
        errors.getState().report(error, { context: "Open workspace" })
        return false
      } finally {
        set({ busy: false })
      }
    },

    async rename(id, name) {
      if (get().busy) return false
      set({ busy: true })
      try {
        await bridge.renameWorkspace(id, name)
        await get().load()
        shell.getState().flash("Workspace renamed")
        return true
      } catch (error) {
        errors.getState().report(error, { context: "Rename workspace" })
        return false
      } finally {
        set({ busy: false })
      }
    },

    async remove(id) {
      if (get().busy) return false
      const record = get().workspaces.find((item) => item.id === id)
      if (!record) return false
      if (
        !window.confirm(
          `Delete the workspace “${record.name}”?\n\nIts files move to the trash and the tabs from it are closed.`
        )
      ) {
        return false
      }
      set({ busy: true })
      try {
        await bridge.deleteWorkspace(id)
        if (get().activeId === id) {
          editor.getState().clearWorkspace()
          await files.getState().refresh(".")
        }
        await get().load()
        notifications.getState().enqueue({
          kind: "info",
          message: `Workspace “${record.name}” moved to the trash`,
          durationMs: 4_000
        })
        return true
      } catch (error) {
        errors.getState().report(error, { context: "Delete workspace" })
        return false
      } finally {
        set({ busy: false })
      }
    }
  }))
}
