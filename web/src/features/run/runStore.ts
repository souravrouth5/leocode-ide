import { createStore, type StoreApi } from "zustand/vanilla"
import type { Bridge, ProcessEvent, RunHandle } from "../../bridge"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { EditorState } from "../editor/editorStore"
import type { PythonState } from "../python/pythonStore"
import { baseName, dirName, isDirty } from "../editor/model"

export interface RunSegment {
  stream: "stdout" | "stderr"
  text: string
}

export interface RunView {
  title: string
  running: boolean
  exitCode: number | null
  segments: RunSegment[]
  hint: string | null
}

export interface RunState {
  run: RunView | null
  /** Sheet visibility. Hiding it must never cancel the process (W-12). */
  sheetOpen: boolean
  /** True from the tap until the process has spawned (W-14). */
  starting: boolean
  runFile(): Promise<void>
  /** Ask the host to kill the process group; the sheet stays open. */
  stop(): void
  /** Hide the sheet and leave the run alone. */
  hide(): void
  /** Show the sheet again for the last run. */
  show(): void
  /** Stop all: cancel the process and forget it (teardown / "Stop all"). */
  close(): void
  /** Forget the cached `python3 --version` probe (W-13). */
  invalidatePythonProbe(): void
}

export type RunStore = StoreApi<RunState> & {
  /** Remove the `pagehide` listener this store installed. */
  dispose(): void
}

/** Output kept per run; the beginning is dropped when a program is chatty. */
export const RUN_LIMIT = 200_000

export const PYTHON_HINT =
  "Python is not installed on this device yet. Open Runtimes, install Python, then run the file again."

export const runKind = (path: string): "python" | "shell" | null => {
  const lower = path.toLowerCase()
  if (lower.endsWith(".py")) return "python"
  if (lower.endsWith(".sh") || lower.endsWith(".bash")) return "shell"
  return null
}

interface RunDeps {
  bridge: Bridge
  editor: StoreApi<EditorState>
  notifications: StoreApi<NotificationsState>
  python: StoreApi<PythonState>
}

export function createRunStore(deps: RunDeps): RunStore {
  const { bridge, editor, notifications, python } = deps
  let handle: RunHandle | null = null
  let buffer: RunSegment[] = []
  let frame: number | null = null
  /** Identifies the run that owns `buffer`/`handle`; stale events are dropped. */
  let runSeq = 0
  let activeRunId: number | null = null

  const cancelFrame = () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame)
      frame = null
    }
  }

  const store = createStore<RunState>((set, get) => {
    const flush = () => {
      frame = null
      const pending = buffer
      if (pending.length === 0) return
      buffer = []
      set((state) => {
        if (!state.run) return state
        const segments = state.run.segments.slice()
        for (const segment of pending) {
          const last = segments[segments.length - 1]
          if (last && last.stream === segment.stream) {
            segments[segments.length - 1] = {
              stream: last.stream,
              text: last.text + segment.text
            }
          } else {
            segments.push({ stream: segment.stream, text: segment.text })
          }
        }
        let total = 0
        for (const segment of segments) total += segment.text.length
        while (total > RUN_LIMIT && segments.length > 0) {
          const first = segments[0]
          const overflow = total - RUN_LIMIT
          if (first.text.length <= overflow) {
            total -= first.text.length
            segments.shift()
          } else {
            segments[0] = { stream: first.stream, text: first.text.slice(overflow) }
            total = RUN_LIMIT
          }
        }
        return { ...state, run: { ...state.run, segments } }
      })
    }

    /** Only the newest run may append output (W-14). */
    const queueFor = (runId: number) => (event: ProcessEvent) => {
      if (activeRunId !== runId) return
      buffer.push({ stream: event.stream, text: event.data })
      if (frame !== null) return
      frame = window.requestAnimationFrame(flush)
    }

    /** Only the newest run may finish, and a stale exit must not null a handle. */
    const finish = (runId: number, exitCode: number | null, hint: string | null) => {
      if (activeRunId !== runId) return
      activeRunId = null
      flush()
      handle = null
      set((state) =>
        state.run
          ? { ...state, run: { ...state.run, running: false, exitCode, hint: state.run.hint ?? hint } }
          : state
      )
    }

    return {
      run: null,
      sheetOpen: false,
      starting: false,

      async runFile() {
        // One spawn at a time: two quick taps must not start two processes (W-14).
        if (get().starting || activeRunId !== null) return
        set({ starting: true })
        try {
          const state = editor.getState()
          const path = state.activePath
          const doc = path ? state.docs.find((item) => item.path === path) : undefined
          if (!doc) return
          const name = baseName(doc.path)
          const kind = runKind(name)
          if (!kind) {
            notifications.getState().enqueue({
              kind: "warning",
              message: "LeoCode can only run .py and .sh files right now",
              detail: `${name} needs an interpreter that is not installed`,
              durationMs: 6_000
            })
            return
          }
          // Never run stale bytes: persist the buffer first when it differs from disk.
          if (isDirty(doc) && !(await editor.getState().save(doc.path))) return

          // Task 26: every runnable file is project code, so ask for trust and
          // resolve the project venv/requirements before spawning anything.
          let plan: { interpreter: string; env: Record<string, string> } | null = null
          if (kind === "python") {
            const prepared = await python.getState().prepareForRun(doc.path)
            if ("hint" in prepared) {
              set({
                sheetOpen: true,
                run: {
                  title: name,
                  running: false,
                  exitCode: null,
                  segments: [],
                  hint: prepared.hint
                }
              })
              return
            }
            plan = prepared
          } else if (!(await python.getState().trust("script", doc.path))) {
            set({
              sheetOpen: true,
              run: {
                title: name,
                running: false,
                exitCode: null,
                segments: [],
                hint: "This script was not trusted, so it was not run."
              }
            })
            return
          }

          const runId = ++runSeq
          activeRunId = runId
          handle = null
          buffer = []
          cancelFrame()
          set({
            // The spawn is done: a second tap may reopen the sheet from here (W-14).
            starting: false,
            sheetOpen: true,
            run: { title: name, running: true, exitCode: null, segments: [], hint: null }
          })

          const argv = kind === "python" ? [plan!.interpreter, name] : ["/system/bin/sh", name]
          try {
            const code = await bridge.run(
              argv,
              dirName(doc.path),
              queueFor(runId),
              (next) => {
                // A handle from a run that is already over must not be installed.
                if (activeRunId === runId) handle = next
                else next.cancel()
              },
              plan ? { env: plan.env } : undefined
            )
            finish(runId, code, null)
          } catch (error) {
            // The run sheet is the error surface here; it shows the message and hint.
            const message = (error as Error).message
            finish(runId, null, kind === "python" ? `${message}\n\n${PYTHON_HINT}` : message)
          }
        } finally {
          set((current) => (current.starting ? { starting: false } : current))
        }
      },

      stop() {
        handle?.cancel()
      },

      hide() {
        set({ sheetOpen: false })
      },

      show() {
        if (get().run) set({ sheetOpen: true })
      },

      close() {
        // "Stop all" / teardown keeps the old cancel-on-close behaviour.
        handle?.cancel()
        handle = null
        activeRunId = null
        cancelFrame()
        buffer = []
        set({ run: null, sheetOpen: false, starting: false })
      },

      invalidatePythonProbe() {
        // A fresh runtime/venv can land while the app is open; drop the cached
        // status so the next Run sees it (W-13).
        void python.getState().refresh()
      }
    }
  })

  // Closing the app stops the job, matching "Stop all" (W-12); hiding the sheet
  // deliberately does not.
  const onPageHide = () => store.getState().close()
  if (typeof window !== "undefined") window.addEventListener("pagehide", onPageHide)

  const api = store as RunStore
  api.dispose = () => {
    if (typeof window !== "undefined") window.removeEventListener("pagehide", onPageHide)
  }
  return api
}
