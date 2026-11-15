import { createStore, type StoreApi } from "zustand/vanilla"
import type { Bridge, WorkspaceInfo } from "../../bridge"
import type { EditorStore } from "../editor/editorStore"
import type { FilesState } from "../files/filesStore"
import type { ShellState } from "../shell/shellStore"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { ErrorsState } from "../../errors/errorsStore"
import type { DialogState } from "../dialogs/dialogStore"
import { dispatchWorkspaceSwitched } from "./workspaceEvents"

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
  dialogs: StoreApi<DialogState>
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
  const { bridge, files, editor, shell, notifications, errors, dialogs } = deps

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
        // Search results and find/replace terms from the previous root must not
        // be jumped into under the new one (PD-14).
        dispatchWorkspaceSwitched(record.id)
        // Restore this workspace's own session if it is still stored (PD-11).
        await editor.getState().restoreSession()
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
      const confirmed = await dialogs.getState().confirm({
        title: "Delete workspace",
        message: `Delete the workspace “${record.name}”?`,
        detail: "Its files move to the trash and the tabs from it are closed.",
        confirmLabel: "Delete",
        danger: true
      })
      if (!confirmed) return false
      set({ busy: true })
      const wasActive = get().activeId === id
      try {
        await bridge.deleteWorkspace(id)
        if (wasActive) {
          editor.getState().clearWorkspace(id)
          await files.getState().refresh(".")
        }
        await get().load()
        if (wasActive) {
          // The old workspace's search results and find terms are stale under
          // the fallback root too (PD-14).
          const fallback = get().activeId
          if (fallback) dispatchWorkspaceSwitched(fallback)
          // The fallback workspace may still have its own stored session, and
          // deleting the active one is effectively a switch to it. Without this
          // its tabs stay hidden until a restart or another switch (PD-11).
          await editor.getState().restoreSession()
        }
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
