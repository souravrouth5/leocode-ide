import { createStore, type StoreApi } from "zustand/vanilla"
import { AppError, type Bridge, type FileEntry } from "../../bridge"
import type { ErrorsState } from "../../errors/errorsStore"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { FilesState } from "../files/filesStore"
import type { SettingsState } from "../settings/settingsStore"
import type { ShellState } from "../shell/shellStore"
import {
  SESSION_KEY,
  baseName,
  dirName,
  entryExists,
  initial,
  isDirty,
  normalizeText,
  type OpenDoc
} from "./model"

export interface EditorState {
  docs: OpenDoc[]
  activePath: string | null
  openFile(path: string): Promise<void>
  openSafDocument(): Promise<void>
  newUntitled(): void
  setContent(path: string, content: string): void
  setActive(path: string): void
  save(path?: string): Promise<boolean>
  beginSaveAs(): void
  saveAs(target: string): Promise<void>
  reload(path?: string): Promise<void>
  close(path: string): void
  closeAll(): void
  restoreSession(): Promise<void>
  deleteEntry(entry: FileEntry): Promise<void>
  renamePath(from: string, to: string): void
}

interface EditorDeps {
  bridge: Bridge
  files: StoreApi<FilesState>
  settings: StoreApi<SettingsState>
  shell: StoreApi<ShellState>
  errors: StoreApi<ErrorsState>
  notifications: StoreApi<NotificationsState>
}

export function createEditorStore(deps: EditorDeps): StoreApi<EditorState> {
  const { bridge, files, settings, shell, errors, notifications } = deps
  let untitledCounter = 1
  let sessionLoaded = false
  let sessionSaveWarned = false

  const store = createStore<EditorState>((set, get) => ({
    docs: [],
    activePath: null,

    async openFile(path) {
      if (get().docs.some((doc) => doc.path === path)) {
        set({ activePath: path })
        shell.getState().go("editor")
        return
      }
      try {
        const raw = await bridge.read(path)
        // Two taps before the read returns must not create duplicate tabs (W-16).
        if (get().docs.some((doc) => doc.path === path)) {
          set({ activePath: path })
          shell.getState().go("editor")
          return
        }
        set((state) => ({ docs: [...state.docs, initial(path, raw)], activePath: path }))
        shell.getState().go("editor")
        const { recentFiles } = settings.getState().settings
        settings.getState().update({
          recentFiles: [path, ...recentFiles.filter((item) => item !== path)].slice(0, 20)
        })
      } catch (error) {
        errors.getState().report(error, { context: "Open file" })
      }
    },

    async openSafDocument() {
      if (!bridge.openSafDocument) return
      try {
        const doc = await bridge.openSafDocument()
        if (!doc) {
          notifications.getState().enqueue({
            kind: "info",
            message: "No document selected",
            durationMs: 3_000
          })
          return
        }
        const safPath = `saf://${doc.name}`
        set((state) => {
          if (state.docs.some((item) => item.path === safPath)) return { activePath: safPath }
          return {
            docs: [...state.docs, initial(safPath, doc.content)],
            activePath: safPath
          }
        })
        shell.getState().go("editor")
        shell.getState().flash(`Opened ${doc.name}`)
      } catch (error) {
        errors.getState().report(error, { context: "Open document" })
      }
    },

    newUntitled() {
      const name = `Untitled-${untitledCounter++}`
      set((state) => ({
        docs: [...state.docs, { path: name, content: "", saved: null, isUntitled: true }],
        activePath: name
      }))
      shell.getState().go("editor")
    },

    setContent(path, content) {
      set((state) => ({
        docs: state.docs.map((doc) => (doc.path === path ? { ...doc, content } : doc))
      }))
    },

    setActive(path) {
      set({ activePath: path })
      shell.getState().go("editor")
    },

    async save(path = get().activePath ?? undefined) {
      if (!path) return false
      const doc = get().docs.find((item) => item.path === path)
      if (!doc) return false
      if (doc.isUntitled || doc.saved === null) {
        get().beginSaveAs()
        return false
      }
      try {
        // Record exactly what was written: text typed while the write was in
        // flight must stay dirty (W-02).
        const written = doc.content
        await bridge.write(path, written)
        set((state) => ({
          docs: state.docs.map((item) =>
            item.path === path ? { ...item, saved: written, isUntitled: false } : item
          )
        }))
        shell.getState().flash("Saved")
        if (dirName(path) === files.getState().cwd) void files.getState().refresh()
        return true
      } catch (error) {
        errors.getState().report(error, { context: "Save file" })
        return false
      }
    },

    beginSaveAs() {
      const path = get().activePath
      const doc = path ? get().docs.find((item) => item.path === path) : undefined
      if (!doc) return
      const initialName = doc.isUntitled
        ? `${doc.path}.txt`
        : doc.path.startsWith("saf://")
          ? doc.path.slice(6)
          : doc.path
      shell.getState().openPrompt({
        title: "Save As",
        label: "Save file as (filename or full path):",
        initial: initialName,
        kind: "file"
      })
    },

    async saveAs(target) {
      const path = get().activePath
      const doc = path ? get().docs.find((item) => item.path === path) : undefined
      if (!doc) return
      if (target === doc.path) {
        await get().save(doc.path)
        return
      }
      // Never create a second tab for an existing open document (W-04).
      if (get().docs.some((item) => item.path === target)) {
        set({ activePath: target })
        errors.getState().report(new AppError("E_EXISTS", `${baseName(target)} is already open`), {
          context: "Save As"
        })
        return
      }
      if (await entryExists(bridge, target)) {
        if (!window.confirm(`${baseName(target)} already exists. Replace it?`)) return
      }
      try {
        await bridge.write(target, doc.content)
        set((state) => ({
          docs: state.docs.map((item) =>
            item.path === doc.path
              ? { ...item, path: target, saved: doc.content, isUntitled: false }
              : item
          ),
          activePath: target
        }))
        shell.getState().flash(`Saved as ${baseName(target)}`)
        await files.getState().refresh()
      } catch (error) {
        errors.getState().report(error, { context: "Save As" })
      }
    },

    async reload(path = get().activePath ?? undefined) {
      if (!path) return
      const doc = get().docs.find((item) => item.path === path)
      if (!doc) return
      if (
        isDirty(doc) &&
        !window.confirm(`Discard unsaved changes to ${baseName(path)} and reload from disk?`)
      ) {
        return
      }
      try {
        const raw = await bridge.read(path)
        const content = normalizeText(raw)
        set((state) => ({
          docs: state.docs.map((item) =>
            item.path === path ? { ...item, content, saved: content } : item
          )
        }))
        shell.getState().flash("Reloaded from disk")
      } catch (error) {
        errors.getState().report(error, { context: "Reload file" })
      }
    },

    close(path) {
      const doc = get().docs.find((item) => item.path === path)
      if (doc && isDirty(doc) && !window.confirm(`Discard unsaved changes to ${baseName(path)}?`)) {
        return
      }
      set((state) => {
        const docs = state.docs.filter((item) => item.path !== path)
        return {
          docs,
          activePath:
            state.activePath === path ? (docs.length ? docs[docs.length - 1].path : null) : state.activePath
        }
      })
    },

    closeAll() {
      if (get().docs.some(isDirty)) {
        if (!window.confirm("You have unsaved changes. Discard and close all tabs?")) return
      }
      set({ docs: [], activePath: null })
    },

    async restoreSession() {
      if (!settings.getState().settings.resumeSession) {
        sessionLoaded = true
        return
      }
      try {
        const raw = localStorage.getItem(SESSION_KEY)
        if (!raw) {
          sessionLoaded = true
          return
        }
        const session = JSON.parse(raw) as { paths: string[]; active: string | null }
        if (!session.paths || session.paths.length === 0) {
          sessionLoaded = true
          return
        }
        let missing = 0
        const loaded = await Promise.all(
          session.paths.map(async (path): Promise<OpenDoc | null> => {
            try {
              return initial(path, await bridge.read(path))
            } catch {
              // The file may have been deleted or moved since last session.
              missing += 1
              return null
            }
          })
        )
        if (missing > 0) {
          notifications.getState().enqueue({
            kind: "warning",
            message: `${missing} restored tab${missing === 1 ? "" : "s"} could not be opened`,
            durationMs: 5_000
          })
        }
        const valid = loaded.filter((doc): doc is OpenDoc => doc !== null)
        if (valid.length > 0) {
          set({
            docs: valid,
            activePath:
              session.active && valid.some((doc) => doc.path === session.active)
                ? session.active
                : valid[0].path
          })
        }
      } catch (error) {
        errors.getState().report(error, { context: "Restore the previous session" })
      } finally {
        sessionLoaded = true
      }
    },

    async deleteEntry(entry) {
      const ok = window.confirm(
        entry.kind === "dir"
          ? `Delete the folder "${entry.name}" and everything in it?`
          : `Delete "${entry.name}"?`
      )
      if (!ok) return
      try {
        await bridge.remove(entry.path)
        set((state) => ({
          docs: state.docs.filter(
            (doc) => doc.path !== entry.path && !doc.path.startsWith(entry.path + "/")
          ),
          activePath:
            state.activePath &&
            (state.activePath === entry.path ||
              state.activePath.startsWith(entry.path + "/"))
              ? null
              : state.activePath
        }))
        shell.getState().flash("Deleted")
        await files.getState().refresh()
      } catch (error) {
        errors.getState().report(error, { context: "Delete" })
      }
    },

    renamePath(from, to) {
      set((state) => ({
        docs: state.docs.map((doc) => (doc.path === from ? { ...doc, path: to } : doc)),
        activePath: state.activePath === from ? to : state.activePath
      }))
    }
  }))

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", persistSession)
  }

  function persistSession() {
    if (!sessionLoaded || !settings.getState().settings.resumeSession) return
    try {
      const state = store.getState()
      const paths = state.docs
        .filter((doc) => !doc.isUntitled && !doc.path.startsWith("saf://"))
        .map((doc) => doc.path)
      const active = state.activePath
      const activeDoc = state.docs.find((doc) => doc.path === active)
      localStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ paths, active: activeDoc?.isUntitled ? null : active })
      )
    } catch {
      // Storage can be full or blocked. Warn once, not on every keystroke.
      if (!sessionSaveWarned) {
        sessionSaveWarned = true
        notifications.getState().enqueue({
          kind: "warning",
          message: "Session state could not be saved",
          durationMs: 5_000
        })
      }
    }
  }

  store.subscribe(() => persistSession())

  return store
}
