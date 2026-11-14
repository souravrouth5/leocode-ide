import { createStore, type StoreApi } from "zustand/vanilla"
import { AppError, type Bridge, type FileEntry } from "../../bridge"
import { toAppError } from "../../errors/catalog"
import type { ErrorsState } from "../../errors/errorsStore"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { FilesState } from "../files/filesStore"
import type { SettingsState } from "../settings/settingsStore"
import type { ShellState } from "../shell/shellStore"
import {
  SESSION_KEY,
  baseName,
  detectEol,
  dirName,
  entryExists,
  initial,
  isDirty,
  isSafPath,
  isUnder,
  normalizeText,
  rewritePrefix,
  serialize,
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

export type EditorStore = StoreApi<EditorState> & {
  /** Remove the window/subscription listeners this store installed (W-26). */
  dispose(): void
}

interface EditorDeps {
  bridge: Bridge
  files: StoreApi<FilesState>
  settings: StoreApi<SettingsState>
  shell: StoreApi<ShellState>
  errors: StoreApi<ErrorsState>
  notifications: StoreApi<NotificationsState>
}

/** Session state is written 300 ms after the last change, not on every key. */
export const SESSION_PERSIST_DEBOUNCE_MS = 300

/** Codes that mean the file is really gone; everything else may be transient. */
const GONE_CODES = new Set(["E_NOT_FOUND", "E_BINARY"])

export function createEditorStore(deps: EditorDeps): EditorStore {
  const { bridge, files, settings, shell, errors, notifications } = deps
  let untitledCounter = 1
  let sessionLoaded = false
  let sessionSaveWarned = false
  let persistTimer: number | null = null
  /**
   * Paths whose restore failed for a transient reason (timeout, permission).
   * They stay in the persisted session so the next launch can try again (W-26).
   */
  const retainedPaths = new Set<string>()

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
        retainedPaths.delete(path)
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
        docs: [
          ...state.docs,
          { path: name, content: "", saved: null, eol: "\n" as const, isUntitled: true }
        ],
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
      // A SAF document is a copy-out: writing it through `fs.write` would target
      // a path the jail does not have (W-19).
      if (isSafPath(doc.path)) return saveSaf(doc, set)
      try {
        // Record exactly what was written: text typed while the write was in
        // flight must stay dirty (W-02). Line endings go back as they were (W-18).
        const written = doc.content
        await bridge.write(path, serialize(doc))
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
      if (isSafPath(doc.path)) {
        // There is no destination picker for Save As, and writing a `saf://`
        // name into the workspace would silently create a stray file (W-19).
        notifications.getState().enqueue({
          kind: "info",
          message: "Save As is not available for documents opened with the system picker",
          detail: "Use Save to export the document again, or open it from the workspace to keep a copy.",
          durationMs: 6_000
        })
        return
      }
      const initialName = doc.isUntitled ? `${doc.path}.txt` : doc.path
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
      if (isSafPath(doc.path)) {
        get().beginSaveAs()
        return
      }
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
        await bridge.write(target, serialize(doc))
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
      if (isSafPath(path)) {
        notifications.getState().enqueue({
          kind: "info",
          message: "Reload is not available for system-picker documents",
          durationMs: 4_000
        })
        return
      }
      if (
        isDirty(doc) &&
        !window.confirm(`Discard unsaved changes to ${baseName(path)} and reload from disk?`)
      ) {
        return
      }
      try {
        const raw = await bridge.read(path)
        const content = normalizeText(raw)
        const eol = detectEol(raw)
        set((state) => ({
          docs: state.docs.map((item) =>
            item.path === path ? { ...item, content, saved: content, eol } : item
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
        const session = JSON.parse(raw) as { paths?: unknown; active?: unknown }
        const paths = Array.isArray(session.paths)
          ? session.paths.filter(
              (path): path is string =>
                typeof path === "string" && path.length > 0 && !isSafPath(path)
            )
          : []
        const active = typeof session.active === "string" ? session.active : null
        if (paths.length === 0) {
          sessionLoaded = true
          return
        }
        let missing = 0
        let deferred = 0
        const loaded = await Promise.all(
          paths.map(async (path): Promise<OpenDoc | null> => {
            try {
              const doc = initial(path, await bridge.read(path))
              retainedPaths.delete(path)
              return doc
            } catch (error) {
              // Only a file that is really gone drops out of the session. A
              // timeout or a not-yet-granted storage permission is retried on the
              // next launch instead of silently forgetting the tab (W-26).
              if (GONE_CODES.has(toAppError(error).code)) {
                missing += 1
                return null
              }
              deferred += 1
              retainedPaths.add(path)
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
        if (deferred > 0) {
          notifications.getState().enqueue({
            kind: "warning",
            message: `${deferred} tab${deferred === 1 ? "" : "s"} could not be opened right now`,
            detail: "They stay in the session and are retried on the next launch.",
            durationMs: 6_000
          })
        }
        // Merge with anything opened while the reads were in flight (W-26) and
        // never replace the user's newer active tab.
        set((state) => {
          const existing = new Set(state.docs.map((doc) => doc.path))
          const restored = loaded.filter(
            (doc): doc is OpenDoc => doc !== null && !existing.has(doc.path)
          )
          if (restored.length === 0) return state
          const docs = [...state.docs, ...restored]
          const activePath =
            state.activePath ??
            (active && docs.some((doc) => doc.path === active) ? active : docs[0].path)
          return { docs, activePath }
        })
      } catch (error) {
        errors.getState().report(error, { context: "Restore the previous session" })
      } finally {
        sessionLoaded = true
        // Rewrite the session immediately: tabs that are really gone must not be
        // re-read on every launch (W-26).
        persistSession()
      }
    },

    async deleteEntry(entry) {
      // A folder delete removes whole buffers; say so before the confirm (W-17).
      const affected = get().docs.filter((doc) => isUnder(doc.path, entry.path))
      const dirty = affected.filter(isDirty).length
      const base =
        entry.kind === "dir"
          ? `Delete the folder "${entry.name}" and everything in it?`
          : `Delete "${entry.name}"?`
      const message =
        dirty > 0
          ? `${base}\n\n${dirty} open tab${dirty === 1 ? " has" : "s have"} unsaved changes, which will be lost.`
          : base
      if (!window.confirm(message)) return
      try {
        await bridge.remove(entry.path)
        set((state) => {
          const docs = state.docs.filter((doc) => !isUnder(doc.path, entry.path))
          const stillOpen =
            state.activePath !== null && docs.some((doc) => doc.path === state.activePath)
          return {
            docs,
            // A surviving tab stays active instead of showing "No file open"
            // above a tab strip that still has tabs (W-17).
            activePath: stillOpen
              ? state.activePath
              : docs.length > 0
                ? docs[docs.length - 1].path
                : null
          }
        })
        shell.getState().flash("Deleted")
        await files.getState().refresh()
      } catch (error) {
        errors.getState().report(error, { context: "Delete" })
      }
    },

    renamePath(from, to) {
      set((state) => {
        const seen = new Set<string>()
        const docs: OpenDoc[] = []
        for (const doc of state.docs) {
          // A folder rename moves every tab under it, not just exact matches (W-17).
          const path = rewritePrefix(doc.path, from, to)
          // Renaming onto an open path must not produce duplicate React keys.
          if (seen.has(path)) continue
          seen.add(path)
          docs.push(path === doc.path ? doc : { ...doc, path })
        }
        const rewrittenActive = state.activePath
          ? rewritePrefix(state.activePath, from, to)
          : null
        return {
          docs,
          activePath:
            rewrittenActive && docs.some((doc) => doc.path === rewrittenActive)
              ? rewrittenActive
              : docs.length > 0
                ? docs[docs.length - 1].path
                : null
        }
      })
    }
  }))

  function saveSaf(
    doc: OpenDoc,
    setState: StoreApi<EditorState>["setState"]
  ): Promise<boolean> {
    const name = doc.path.slice("saf://".length)
    const save = bridge.saveSafDocument
    if (!save) {
      errors
        .getState()
        .report(
          new AppError("E_UNSUPPORTED", "This bridge cannot export documents through the system picker"),
          { context: "Save document" }
        )
      return Promise.resolve(false)
    }
    const written = doc.content
    return Promise.resolve(save.call(bridge, name, serialize(doc)))
      .then((result) => {
        if (!result) {
          // The system picker was dismissed: nothing was exported, keep it dirty.
          shell.getState().flash("Export cancelled")
          return false
        }
        setState((state) => ({
          docs: state.docs.map((item) =>
            item.path === doc.path ? { ...item, saved: written } : item
          )
        }))
        shell.getState().flash(`Exported ${name}`)
        return true
      })
      .catch((error: unknown) => {
        errors.getState().report(error, { context: "Export document" })
        return false
      })
  }

  function persistSession() {
    if (!sessionLoaded || !settings.getState().settings.resumeSession) return
    try {
      const state = store.getState()
      const paths = state.docs
        .filter((doc) => !doc.isUntitled && !isSafPath(doc.path))
        .map((doc) => doc.path)
      for (const retained of retainedPaths) {
        if (!paths.includes(retained)) paths.push(retained)
      }
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

  /** Debounced: one `JSON.stringify` + `setItem` per burst, not per keystroke. */
  function schedulePersist() {
    if (typeof window === "undefined") return
    if (persistTimer !== null) window.clearTimeout(persistTimer)
    persistTimer = window.setTimeout(() => {
      persistTimer = null
      persistSession()
    }, SESSION_PERSIST_DEBOUNCE_MS)
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", persistSession)
  }
  const unsubscribe = store.subscribe(schedulePersist)

  const api = store as EditorStore
  api.dispose = () => {
    unsubscribe()
    if (typeof window !== "undefined") {
      window.removeEventListener("beforeunload", persistSession)
      if (persistTimer !== null) {
        window.clearTimeout(persistTimer)
        persistTimer = null
      }
    }
  }

  return api
}
