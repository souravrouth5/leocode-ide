import { createStore, type StoreApi } from "zustand/vanilla"
import type {
  Bridge,
  UpdateCheck,
  UpdateInstallHandle,
  UpdateProgress
} from "../../bridge"
import { AppError } from "../../bridge"
import type { ErrorsState } from "../../errors/errorsStore"

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "verifying"
  | "installer"
  | "error"

export interface UpdateState {
  status: UpdateStatus
  /** Last verified manifest, kept so the card can show notes and sizes. */
  check: UpdateCheck | null
  progress: UpdateProgress | null
  error: AppError | null
  checkedAt: number | null
  /** Fetch and verify `release.json`; safe to repeat. */
  checkForUpdate(): Promise<void>
  /** Download, verify and hand the APK to Android's installer. */
  install(): Promise<void>
  /** Ask the host to stop the download; the terminal event still arrives. */
  cancel(): void
}

interface UpdateDeps {
  bridge: Bridge
  errors: StoreApi<ErrorsState>
}

/**
 * Signed self-update (Task 28).
 *
 * The host verifies the Ed25519 manifest, the APK SHA-256 and the APK signer
 * before Android's installer is opened. This store only models the UI: a check
 * that is safe to repeat, one download at a time, and progress that survives
 * re-renders. Installing is always a visible system prompt.
 */
export function createUpdateStore({ bridge, errors }: UpdateDeps): StoreApi<UpdateState> {
  let handle: UpdateInstallHandle | null = null
  let running: Promise<void> | null = null

  return createStore<UpdateState>((set, get) => ({
    status: "idle",
    check: null,
    progress: null,
    error: null,
    checkedAt: null,

    async checkForUpdate() {
      if (get().status === "checking" || get().status === "downloading") return
      if (!bridge.checkForUpdate) {
        set({
          status: "error",
          error: new AppError("E_UNSUPPORTED", "this build cannot check for updates")
        })
        return
      }
      set({ status: "checking", error: null })
      try {
        const check = await bridge.checkForUpdate()
        set({
          check,
          status: check.available ? "available" : "current",
          checkedAt: Date.now(),
          progress: null
        })
      } catch (error) {
        const appError = toAppError(error, "the update check failed")
        set({ status: "error", error: appError })
        errors.getState().report(appError, { context: "Check for updates" })
      }
    },

    install() {
      if (running) return running
      const check = get().check
      if (!check?.available || !check.url || !check.sha256 || !check.size || !check.versionCode) {
        set({
          status: "error",
          error: new AppError("E_BAD_MANIFEST", "the update details are incomplete")
        })
        return Promise.resolve()
      }
      if (!bridge.installUpdate) {
        set({
          status: "error",
          error: new AppError("E_UNSUPPORTED", "this build cannot install updates")
        })
        return Promise.resolve()
      }

      set({ status: "downloading", progress: null, error: null })
      running = bridge
        .installUpdate(
          {
            url: check.url,
            sha256: check.sha256,
            size: check.size,
            versionCode: check.versionCode
          },
          (progress) => {
            const status =
              progress.phase === "verify"
                ? "verifying"
                : progress.phase === "install"
                  ? "installer"
                  : "downloading"
            set({ progress, status })
          },
          (next) => {
            handle = next
          }
        )
        .then(() => {
          set({ status: "installer" })
        })
        .catch((error: unknown) => {
          const appError = toAppError(error, "the update could not be installed")
          if (appError.code === "E_CANCELLED") {
            // A cancel is a user decision, not a failure to report.
            set({ status: "available", progress: null, error: null })
            return
          }
          set({ status: "error", error: appError, progress: null })
          errors.getState().report(appError, { context: "Install update" })
        })
        .finally(() => {
          running = null
          handle = null
        })
      return running
    },

    cancel() {
      handle?.cancel()
    }
  }))
}

function toAppError(error: unknown, fallback: string): AppError {
  if (error instanceof AppError) return error
  return new AppError("E_INTERNAL", fallback)
}
