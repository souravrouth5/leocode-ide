import { createStore, type StoreApi } from "zustand/vanilla"
import type { Bridge, ProcessEvent, RunHandle } from "../../bridge"
import type { NotificationsState } from "../../notifications/notificationsStore"
import type { EditorState } from "../editor/editorStore"
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
  runFile(): Promise<void>
  stop(): void
  close(): void
}

/** Output kept per run; the beginning is dropped when a program is chatty. */
export const RUN_LIMIT = 200_000

export const PYTHON_HINT =
  "Python is not installed on this device yet. The bundled CPython runtime is the next milestone — use the Terminal for shell work until then."

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
}

export function createRunStore(deps: RunDeps): StoreApi<RunState> {
  const { bridge, editor, notifications } = deps
  let handle: RunHandle | null = null
  let buffer: RunSegment[] = []
  let frame: number | null = null
  let pythonReady: boolean | null = null

  const cancelFrame = () => {
    if (frame !== null) {
      window.cancelAnimationFrame(frame)
      frame = null
    }
  }

  const store = createStore<RunState>((set) => {
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

    const queue = (event: ProcessEvent) => {
      buffer.push({ stream: event.stream, text: event.data })
      if (frame !== null) return
      frame = window.requestAnimationFrame(flush)
    }

    const finish = (exitCode: number | null, hint: string | null) => {
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

      async runFile() {
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

        // `python3` is either present or not; probe once per session so the sheet
        // can explain the missing runtime instead of showing a raw exec error.
        if (kind === "python" && pythonReady === null) {
          try {
            pythonReady = (await bridge.run(["python3", "--version"], ".", () => {})) === 0
          } catch {
            pythonReady = false
          }
        }
        if (kind === "python" && !pythonReady) {
          set({
            run: {
              title: name,
              running: false,
              exitCode: null,
              segments: [],
              hint: PYTHON_HINT
            }
          })
          return
        }

        buffer = []
        cancelFrame()
        set({ run: { title: name, running: true, exitCode: null, segments: [], hint: null } })

        const argv = kind === "python" ? ["python3", name] : ["/system/bin/sh", name]
        try {
          const code = await bridge.run(argv, dirName(doc.path), queue, (next) => {
            handle = next
          })
          finish(code, null)
        } catch (error) {
          // The run sheet is the error surface here; it shows the message and hint.
          const message = (error as Error).message
          finish(null, kind === "python" ? `${message}\n\n${PYTHON_HINT}` : message)
        }
      },

      stop() {
        handle?.cancel()
      },

      close() {
        handle?.cancel()
        handle = null
        cancelFrame()
        buffer = []
        set({ run: null })
      }
    }
  })

  return store
}
