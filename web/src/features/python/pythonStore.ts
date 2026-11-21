import { createStore, type StoreApi } from "zustand/vanilla"
import type { Bridge, PythonStatus, TrustAction } from "../../bridge"
import type { DialogState } from "../dialogs/dialogStore"
import type { ErrorsState } from "../../errors/errorsStore"
import type { NotificationsState } from "../../notifications/notificationsStore"

export interface PythonRunPlan {
  interpreter: string
  env: Record<string, string>
}

export interface PythonRunFailure {
  hint: string
}

export type PythonRunPrep = PythonRunPlan | PythonRunFailure

export interface PythonState {
  status: PythonStatus | null
  busy: boolean
  /** Pip output from the most recent requirements install, newest last. */
  installLog: string[]
  refresh(): Promise<PythonStatus | null>
  /** Ask for (and remember) trust for one project action. */
  trust(action: TrustAction, path?: string): Promise<boolean>
  ensureVenv(): Promise<boolean>
  removeVenv(): Promise<boolean>
  installRequirements(): Promise<boolean>
  /** Interpreter/env for Run, including the venv and requirements prompts. */
  prepareForRun(path: string): Promise<PythonRunPrep>
}

interface PythonDeps {
  bridge: Bridge
  dialogs: StoreApi<DialogState>
  notifications: StoreApi<NotificationsState>
  errors: StoreApi<ErrorsState>
}

const TRUST_COPY: Record<TrustAction, string> = {
  script:
    "Running a project script can read your files, start processes and use the network.",
  pip: "Installing packages runs the package's build code with this app's permissions.",
  venv: "A project environment runs Python from the bundled runtime in this project.",
  "git-hooks": "Git hooks run project code automatically on commit and checkout."
}

export const PYTHON_NOT_INSTALLED =
  "Python is not installed yet. Open Runtimes, install Python, then try again."

/**
 * Per-project Python workflow (Task 26).
 *
 * Every action that can execute project code goes through [trust] first. A
 * remembered grant is tied to the current file fingerprint host-side, so an
 * edited script or `requirements.txt` asks again.
 */
export function createPythonStore(deps: PythonDeps): StoreApi<PythonState> {
  const { bridge, dialogs, notifications, errors } = deps
  let active: Promise<PythonStatus | null> | null = null

  const store = createStore<PythonState>((set, get) => {
    const refreshNow = async (): Promise<PythonStatus | null> => {
      try {
        const status = await bridge.pythonStatus({})
        set({ status })
        return status
      } catch (error) {
        set({ status: null })
        errors.getState().report(error, { context: "Check the Python environment" })
        return null
      }
    }

    return {
      status: null,
      busy: false,
      installLog: [],

      refresh() {
        // Collapse concurrent refreshes (Run and the Runtimes view can ask together).
        if (!active) {
          active = refreshNow().finally(() => {
            active = null
          })
        }
        return active
      },

      async trust(action, path) {
        try {
          const check = await bridge.trustCheck({ action, path })
          if (check.trusted) return true
        } catch (error) {
          errors.getState().report(error, { context: "Check project trust" })
          return false
        }
        const confirmed = await dialogs.getState().confirm({
          title: "Trust this project?",
          message: TRUST_COPY[action],
          detail:
            "Only continue if you trust the files in this project. " +
            "You will be asked again if they change.",
          confirmLabel: "Trust and continue"
        })
        if (!confirmed) return false
        try {
          await bridge.trustGrant({ action, path })
          return true
        } catch (error) {
          errors.getState().report(error, { context: "Remember project trust" })
          return false
        }
      },

      async ensureVenv() {
        const status = get().status ?? (await get().refresh())
        if (!status) return false
        if (status.venvExists) return true
        if (!status.runtimeInstalled) {
          notifications.getState().enqueue({
            kind: "warning",
            message: "Python is not installed",
            detail: PYTHON_NOT_INSTALLED,
            durationMs: 6_000
          })
          return false
        }
        if (!(await get().trust("venv"))) return false
        set({ busy: true })
        try {
          const result = await bridge.pythonCreateVenv({})
          set({ status: result.status })
          notifications.getState().enqueue({
            kind: "success",
            message: result.created ? "Python environment created" : "Python environment ready",
            detail: ".venv in this project",
            durationMs: 3_500
          })
          return true
        } catch (error) {
          errors.getState().report(error, { context: "Create the Python environment" })
          return false
        } finally {
          set({ busy: false })
        }
      },

      async removeVenv() {
        const status = get().status
        if (!status?.venvExists) return true
        const confirmed = await dialogs.getState().confirm({
          title: "Remove Python environment",
          message: "Remove this project's .venv?",
          detail: "Installed packages in it are deleted. Project files are kept.",
          confirmLabel: "Remove",
          danger: true
        })
        if (!confirmed) return false
        set({ busy: true })
        try {
          const next = await bridge.pythonRemoveVenv({})
          set({ status: next, installLog: [] })
          notifications.getState().enqueue({
            kind: "success",
            message: "Python environment removed",
            durationMs: 3_000
          })
          return true
        } catch (error) {
          errors.getState().report(error, { context: "Remove the Python environment" })
          return false
        } finally {
          set({ busy: false })
        }
      },

      async installRequirements() {
        const status = get().status ?? (await get().refresh())
        if (!status?.requirementsExists) {
          notifications.getState().enqueue({
            kind: "warning",
            message: "No requirements.txt",
            detail: "Add requirements.txt to this project first.",
            durationMs: 5_000
          })
          return false
        }
        if (!(await get().ensureVenv())) return false
        if (!(await get().trust("pip"))) return false
        set({ busy: true, installLog: [] })
        try {
          const result = await bridge.pythonInstallRequirements({}, (line) => {
            set((state) => ({
              installLog: [...state.installLog.slice(-199), line]
            }))
          })
          if (!result.ok) {
            notifications.getState().enqueue({
              kind: "error",
              message: "Requirements did not install",
              detail:
                result.output.trim().split("\n").slice(-3).join("\n") ||
                `pip exited with ${result.exitCode}`,
              durationMs: 10_000
            })
          } else {
            notifications.getState().enqueue({
              kind: "success",
              message: "Requirements installed",
              durationMs: 3_500
            })
          }
          await get().refresh()
          return result.ok
        } catch (error) {
          errors.getState().report(error, { context: "Install requirements" })
          return false
        } finally {
          set({ busy: false })
        }
      },

      async prepareForRun(path) {
        const status = await get().refresh()
        if (!status) return { hint: PYTHON_NOT_INSTALLED }
        const interpreter = status.venvPython ?? status.runtimePython
        if (!interpreter) return { hint: PYTHON_NOT_INSTALLED }

        if (!(await get().trust("script", path))) {
          return { hint: "This script was not trusted, so it was not run." }
        }

        if (status.requirementsExists && !status.requirementsInstalled) {
          const install = await dialogs.getState().confirm({
            title: "Install requirements?",
            message: "This project has a requirements.txt that is not installed.",
            detail: "Packages install into this project's .venv before the script runs.",
            confirmLabel: "Install and run"
          })
          if (!install) return { hint: "Install requirements.txt before running this project." }
          if (!(await get().installRequirements())) {
            return { hint: "The requirements did not install, so the script was not run." }
          }
          const next = get().status
          if (next?.venvPython) {
            return {
              interpreter: next.venvPython,
              env: venvEnv(next)
            }
          }
        }

        return {
          interpreter,
          env: status.venvExists ? venvEnv(status) : {}
        }
      }
    }
  })

  return store
}

/** PATH and VIRTUAL_ENV for a run that should use the project venv. */
export function venvEnv(status: PythonStatus): Record<string, string> {
  const runtime = status.runtimePython ?? ""
  const usr = runtime.endsWith("/bin/python3")
    ? runtime.slice(0, -"/bin/python3".length)
    : null
  const path = [
    `${status.venvPath}/bin`,
    ...(usr ? [`${usr}/bin`] : []),
    "/system/bin",
    "/system/xbin"
  ].join(":")
  return {
    VIRTUAL_ENV: status.venvPath,
    PATH: path
  }
}
