import { createStore, type StoreApi } from "zustand/vanilla"
import type { SafProgress, SafProgressPhase } from "../../bridge"

/**
 * Import/export/restore progress (PD-25).
 *
 * The heavy SAF operations keep running after the Settings sheet is closed, so
 * their status lives here instead of in AppDialogs' local state: the Shell
 * renders a persistent row while `busy` is true.
 */

export type BackupOperation = "import" | "export" | "restore"

export interface BackupProgress {
  phase: SafProgressPhase
  files: number
  bytes: number
}

export interface BackupState {
  busy: boolean
  operation: BackupOperation | null
  /** Human-readable line: phase progress while running, the result when done. */
  status: string | null
  /** Latest host progress, when the operation reports one. */
  progress: BackupProgress | null
  startedAt: number | null
  /** Start an operation and show the first status line. */
  begin(operation: BackupOperation, status: string): void
  /** Replace the status line (and record host progress when provided). */
  update(status: string, progress?: BackupProgress): void
  /** Finish successfully; the banner hides and Settings keeps the result line. */
  finish(status: string): void
  /** Finish after an error; the banner hides and the error surfaces report it. */
  fail(): void
  reset(): void
}

export function createBackupStore(): StoreApi<BackupState> {
  return createStore<BackupState>((set) => ({
    busy: false,
    operation: null,
    status: null,
    progress: null,
    startedAt: null,

    begin(operation, status) {
      set({
        busy: true,
        operation,
        status,
        progress: null,
        startedAt: Date.now()
      })
    },

    update(status, progress) {
      set((state) => ({
        status,
        progress: progress ?? state.progress
      }))
    },

    finish(status) {
      set({ busy: false, operation: null, status })
    },

    fail() {
      set({ busy: false, operation: null, status: null, progress: null })
    },

    reset() {
      set({
        busy: false,
        operation: null,
        status: null,
        progress: null,
        startedAt: null
      })
    }
  }))
}

/** The single status line AppDialogs feeds both the sheet and the Shell row. */
export function describeProgress(progress: SafProgress): string {
  return `${progress.phase}: ${progress.files} file${progress.files === 1 ? "" : "s"} (${(
    progress.bytes / 1024
  ).toFixed(1)} KB)`
}
