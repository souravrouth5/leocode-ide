import { createStore, type StoreApi } from "zustand/vanilla"
import { AppError, type Bridge, type FileEntry } from "../../bridge"
import { toAppError } from "../../errors/catalog"
import type { ErrorsState } from "../../errors/errorsStore"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { FilesState } from "../files/filesStore"
import type { SettingsState } from "../settings/settingsStore"
import type { ShellState } from "../shell/shellStore"
import {
  LARGE_FILE_BYTES,
  LARGE_FILE_CHUNK,
  SESSION_KEY,
  baseName,
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
  /** Task 15: recovery and conflict actions. */
  restoreDraft(path: string): void
  discardDraft(path: string): void
  keepMine(path: string): Promise<void>
  /** Poll the host for mtime/hash changes behind the open buffers. */
  checkExternal(): Promise<void>
  /** Forget every buffer when the user switches workspace. */
  clearWorkspace(): void
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

/** Idle time before a dirty buffer is written to `draft.save` (Task 15). */
export const DRAFT_AUTOSAVE_MS = 3_000

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
        const doc = await loadDocument(path)
        // Two taps before the read returns must not create duplicate tabs (W-16).
        if (get().docs.some((item) => item.path === path)) {
          set({ activePath: path })
          shell.getState().go("editor")
          return
        }
        retainedPaths.delete(path)
        set((state) => ({ docs: [...state.docs, doc], activePath: path }))
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
          {
            path: name,
            content: "",
            saved: null,
            eol: "\n" as const,
            isUntitled: true,
            mtime: 0,
            hash: "",
            externalChange: false,
            draft: null
          }
        ],
        activePath: name
      }))
      shell.getState().go("editor")
    },

    setContent(path, content) {
      set((state) => ({
        docs: state.docs.map((doc) =>
          doc.path === path && !doc.readOnly ? { ...doc, content } : doc
        )
      }))
      scheduleDraft(path)
    },

    setActive(path) {
      set({ activePath: path })
      shell.getState().go("editor")
    },

    async save(path = get().activePath ?? undefined) {
      if (!path) return false
      const doc = get().docs.find((item) => item.path === path)
      if (!doc) return false
      if (doc.isUntitled) {
        get().beginSaveAs()
        return false
      }
      // `saved === null` with a real path means Keep mine made the buffer
      // authoritative; it still saves in place instead of asking for a new name.
      // A SAF document is a copy-out: writing it through `fs.write` would target
      // a path the jail does not have (W-19).
      if (isSafPath(doc.path)) return saveSaf(doc, set)
      try {
        if (doc.readOnly) {
          notifications.getState().enqueue({
            kind: "info",
            message: "This file is open in large-file mode",
            detail: "Editing is disabled so a multi-megabyte file is not rewritten by accident.",
            durationMs: 5_000
          })
          return false
        }
        // Record exactly what was written: text typed while the write was in
        // flight must stay dirty (W-02). Line endings go back as they were (W-18).
        const written = doc.content
        const result = await bridge.writeChecked(
          path,
          serialize(doc),
          doc.hash && doc.hash.length > 0 ? doc.hash : null
        )
        clearDraft(path)
        set((state) => ({
          docs: state.docs.map((item) =>
            item.path === path
              ? {
                  ...item,
                  saved: written,
                  isUntitled: false,
                  hash: result.hash,
                  mtime: result.mtime,
                  externalChange: false
                }
              : item
          )
        }))
        shell.getState().flash("Saved")
        if (dirName(path) === files.getState().cwd) void files.getState().refresh()
        return true
      } catch (error) {
        if (error instanceof AppError && error.code === "E_CONFLICT") {
          set((state) => ({
            docs: state.docs.map((item) =>
              item.path === path ? { ...item, externalChange: true } : item
            )
          }))
          notifications.getState().enqueue({
            kind: "warning",
            message: `${baseName(path)} changed on disk`,
            detail: "Reload it, or choose Keep mine before saving again.",
            durationMs: 7_000
          })
          return false
        }
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
        const result = await bridge.writeChecked(target, serialize(doc), null)
        if (!doc.isUntitled && !isSafPath(doc.path)) void bridge.deleteDraft(doc.path).catch(() => {})
        set((state) => ({
          docs: state.docs.map((item) =>
            item.path === doc.path
              ? {
                  ...item,
                  path: target,
                  saved: doc.content,
                  isUntitled: false,
                  readOnly: false,
                  hash: result.hash,
                  mtime: result.mtime,
                  externalChange: false
                }
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
        const fresh = await loadDocument(path, false)
        clearDraft(path)
        set((state) => ({
          docs: state.docs.map((item) =>
            item.path === path
              ? {
                  ...fresh,
                  draft: null,
                  externalChange: false,
                  // Reload never resurrects a tab that was closed meanwhile.
                  isUntitled: item.isUntitled
                }
              : item
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
      if (doc && !doc.isUntitled && !isSafPath(path)) void bridge.deleteDraft(path).catch(() => {})
      clearDraftTimer(path)
    },

    closeAll() {
      if (get().docs.some(isDirty)) {
        if (!window.confirm("You have unsaved changes. Discard and close all tabs?")) return
      }
      for (const doc of get().docs) {
        if (!doc.isUntitled && !isSafPath(doc.path)) {
          void bridge.deleteDraft(doc.path).catch(() => {})
        }
        clearDraftTimer(doc.path)
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
              const doc = await loadDocument(path)
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
      // A draft is keyed by path; move it with the file so recovery still works.
      void bridge.readDraft(from).then((draft) => {
        if (!draft) return
        void bridge.saveDraft(to, draft.content, draft.eol).catch(() => {})
        void bridge.deleteDraft(from).catch(() => {})
      }).catch(() => {})
    },

    restoreDraft(path) {
      set((state) => ({
        docs: state.docs.map((doc) =>
          doc.path === path && doc.draft
            ? {
                ...doc,
                content: doc.draft.content,
                eol: doc.draft.eol,
                // `saved` stays the on-disk text, so the restored buffer is dirty.
                draft: null
              }
            : doc
        )
      }))
      void bridge.deleteDraft(path).catch(() => {})
      shell.getState().flash("Draft restored")
    },

    discardDraft(path) {
      set((state) => ({
        docs: state.docs.map((doc) => (doc.path === path ? { ...doc, draft: null } : doc))
      }))
      void bridge.deleteDraft(path).catch(() => {})
    },

    async keepMine(path) {
      const doc = get().docs.find((item) => item.path === path)
      if (!doc) return
      let hash = ""
      let mtime = 0
      try {
        const stat = await bridge.stat(path)
        if (stat.kind === "file") {
          hash = stat.hash
          mtime = stat.mtime
        }
      } catch (error) {
        // Keep mine also covers a file that vanished: saving then recreates it.
        if (!(error instanceof AppError && error.code === "E_NOT_FOUND")) {
          errors.getState().report(error, { context: "Keep local version" })
          return
        }
      }
      set((state) => ({
        docs: state.docs.map((item) =>
          item.path === path
            ? {
                ...item,
                hash,
                mtime,
                // Dirty on purpose: the next save writes this buffer over the
                // version that appeared on disk.
                saved: null,
                externalChange: false,
                draft: null
              }
            : item
        )
      }))
      shell.getState().flash("Keeping your version")
    },

    async checkExternal() {
      const candidates = get().docs.filter(
        (doc) => !doc.isUntitled && !isSafPath(doc.path) && doc.hash && !doc.readOnly
      )
      if (candidates.length === 0) return
      const changed = new Set<string>()
      await Promise.all(
        candidates.map(async (doc) => {
          try {
            const stat = await bridge.stat(doc.path)
            if (stat.kind !== "file") {
              changed.add(doc.path)
              return
            }
            if (stat.hash !== doc.hash || stat.mtime !== doc.mtime) {
              if (!doc.externalChange) changed.add(doc.path)
            }
          } catch (error) {
            if (error instanceof AppError && error.code === "E_NOT_FOUND") {
              changed.add(doc.path)
            }
            // A timeout or permission failure is not evidence that the file
            // changed; the next poll tries again.
          }
        })
      )
      if (changed.size === 0) return
      set((state) => ({
        docs: state.docs.map((doc) =>
          changed.has(doc.path) ? { ...doc, externalChange: true } : doc
        )
      }))
    },

    clearWorkspace() {
      for (const doc of get().docs) clearDraftTimer(doc.path)
      set({ docs: [], activePath: null })
    }
  }))

  // ------------------------------------------------------- file loading/drafts

  /**
   * Reads a file into an `OpenDoc`. Above [LARGE_FILE_BYTES] only the first
   * [LARGE_FILE_CHUNK] bytes are loaded, and the document is read-only.
   */
  async function loadDocument(path: string, withDraft = true): Promise<OpenDoc> {
    let size = 0
    let mtime = 0
    let hash = ""
    try {
      const stat = await bridge.stat(path)
      size = stat.size
      mtime = stat.mtime
      hash = stat.hash
    } catch {
      // A host without fs.stat still supports the old whole-file read.
    }
    if (size > LARGE_FILE_BYTES) {
      const chunk = await bridge.readChunk(path, 0, LARGE_FILE_CHUNK)
      return initial(path, chunk.content, {
        mtime: chunk.mtime,
        hash: chunk.hash,
        large: true,
        truncated: chunk.nextOffset !== -1
      })
    }
    const raw = await bridge.read(path)
    const doc = initial(path, raw, { mtime, hash })
    if (withDraft) await attachDraft(doc)
    return doc
  }

  async function attachDraft(doc: OpenDoc): Promise<void> {
    if (doc.readOnly) return
    try {
      const draft = await bridge.readDraft(doc.path)
      if (!draft) return
      // A draft identical to the disk text has nothing to recover.
      if (normalizeText(draft.content) === doc.content) {
        void bridge.deleteDraft(doc.path).catch(() => {})
        return
      }
      doc.draft = {
        content: normalizeText(draft.content),
        eol: draft.eol === "\r\n" ? "\r\n" : "\n",
        mtime: draft.mtime
      }
    } catch {
      // No draft, or the host cannot read one: opening the file still works.
    }
  }

  const draftTimers = new Map<string, number>()

  function clearDraftTimer(path: string) {
    const timer = draftTimers.get(path)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      draftTimers.delete(path)
    }
  }

  /** Task 15: one `draft.save` three seconds after typing stops. */
  function scheduleDraft(path: string) {
    if (typeof window === "undefined") return
    clearDraftTimer(path)
    draftTimers.set(
      path,
      window.setTimeout(() => {
        draftTimers.delete(path)
        const doc = store.getState().docs.find((item) => item.path === path)
        if (!doc || doc.isUntitled || isSafPath(path) || doc.readOnly) return
        if (!isDirty(doc)) {
          void bridge.deleteDraft(path).catch(() => {})
          return
        }
        void bridge.saveDraft(path, serialize(doc), doc.eol).catch(() => {
          // Autosave must never interrupt typing; the next idle period retries.
        })
      }, DRAFT_AUTOSAVE_MS)
    )
  }

  function clearDraft(path: string) {
    clearDraftTimer(path)
    void bridge.deleteDraft(path).catch(() => {})
  }

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
      for (const timer of draftTimers.values()) window.clearTimeout(timer)
    }
    draftTimers.clear()
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
