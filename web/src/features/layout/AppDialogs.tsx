import { useState } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import type { SafProgress } from "../../bridge"
import { PromptDialog } from "../../components/PromptDialog"
import { RunSheet } from "../../components/RunSheet"
import { SettingsDialog } from "../../components/SettingsDialog"
import { FindReplaceSheet } from "../../components/FindReplaceSheet"
import { SearchPanel } from "../../components/SearchPanel"
import { ErrorSurfaces } from "../../errors/ErrorSurfaces"
import { PaneBoundary } from "../../errors/PaneBoundary"
import { submitPrompt } from "../shell/promptActions"

/** All sheets/dialogs, wired to their stores. */
export function AppDialogs({ version }: { version: string }) {
  const stores = useStores()
  const { run, shell, settings, errors, notifications, files, bridge, editor } = stores
  const runState = useStore(run, (state) => state.run)
  const sheetOpen = useStore(run, (state) => state.sheetOpen)
  const prompt = useStore(shell, (state) => state.prompt)
  const settingsOpen = useStore(shell, (state) => state.settingsOpen)
  const userSettings = useStore(settings, (state) => state.settings)
  const storage = useStore(files, (state) => state.storage)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)

  const requestStoragePermission = () => {
    void files.getState().requestStoragePermission()
  }

  const describe = (progress: SafProgress) =>
    `${progress.phase}: ${progress.files} file${progress.files === 1 ? "" : "s"} (${(
      progress.bytes /
      1024
    ).toFixed(1)} KB)`

  const importFolder = async () => {
    setBackupBusy(true)
    setBackupStatus("Choose a folder…")
    try {
      const result = await bridge.importTree(null, (progress) =>
        setBackupStatus(describe(progress))
      )
      if (!result) {
        setBackupStatus("Import cancelled")
        return
      }
      setBackupStatus(`Imported ${result.files} files into ${result.path}`)
      notifications.getState().enqueue({
        kind: "success",
        message: `Imported ${result.files} files`,
        durationMs: 4_000
      })
      await files.getState().refresh()
    } catch (error) {
      errors.getState().report(error, { context: "Import folder" })
      setBackupStatus(null)
    } finally {
      setBackupBusy(false)
    }
  }

  const exportBackup = async () => {
    setBackupBusy(true)
    setBackupStatus("Preparing backup…")
    try {
      const result = await bridge.exportWorkspace("leocode-backup.zip", (progress) =>
        setBackupStatus(describe(progress))
      )
      if (!result) {
        setBackupStatus("Export cancelled")
        return
      }
      setBackupStatus(`Backed up ${result.files} files (${(result.bytes / 1024).toFixed(1)} KB)`)
      notifications.getState().enqueue({
        kind: "success",
        message: "Workspace backup exported",
        durationMs: 4_000
      })
    } catch (error) {
      errors.getState().report(error, { context: "Export backup" })
      setBackupStatus(null)
    } finally {
      setBackupBusy(false)
    }
  }

  const restoreBackup = async () => {
    if (
      !window.confirm(
        "Restore a backup into the active workspace?\n\nFiles with the same name are replaced. Unrelated files are kept."
      )
    ) {
      return
    }
    setBackupBusy(true)
    setBackupStatus("Choose a backup…")
    try {
      const result = await bridge.restoreArchive((progress) => setBackupStatus(describe(progress)))
      if (!result) {
        setBackupStatus("Restore cancelled")
        return
      }
      setBackupStatus(`Restored ${result.files} files (${(result.bytes / 1024).toFixed(1)} KB)`)
      notifications.getState().enqueue({
        kind: "success",
        message: "Backup restored",
        detail: "Open tabs are reloaded automatically if their file changed.",
        durationMs: 5_000
      })
      await files.getState().refresh()
      await editor.getState().checkExternal()
    } catch (error) {
      errors.getState().report(error, { context: "Restore backup" })
      setBackupStatus(null)
    } finally {
      setBackupBusy(false)
    }
  }

  return (
    <>
      <PaneBoundary title="The find and replace sheet crashed">
        <FindReplaceSheet />
      </PaneBoundary>

      <PaneBoundary title="The workspace search crashed">
        <SearchPanel />
      </PaneBoundary>

      <PaneBoundary title="The run output crashed">
        <RunSheet
          open={runState !== null && sheetOpen}
          title={runState?.title ?? ""}
          running={runState?.running ?? false}
          exitCode={runState?.exitCode ?? null}
          segments={runState?.segments ?? []}
          hint={runState?.hint}
          onStop={() => run.getState().stop()}
          // Closing the sheet hides it; the process keeps running (W-12).
          onClose={() => run.getState().hide()}
        />
      </PaneBoundary>

      <PaneBoundary title="Settings crashed">
        <SettingsDialog
          open={settingsOpen}
          onClose={() => shell.getState().setSettingsOpen(false)}
          settings={userSettings}
          onUpdate={(patch) => settings.getState().update(patch)}
          bridgeMode={bridge.mode}
          version={version}
          onOpenRuntimes={() => shell.getState().go("runtimes")}
          storage={storage}
          onRequestStoragePermission={requestStoragePermission}
          onImportFolder={() => void importFolder()}
          onExportBackup={() => void exportBackup()}
          onRestoreBackup={() => void restoreBackup()}
          backupBusy={backupBusy}
          backupStatus={backupStatus}
        />
      </PaneBoundary>

      <PaneBoundary title="The prompt crashed">
        <PromptDialog
          open={prompt !== null}
          title={prompt?.title ?? ""}
          label={prompt?.label}
          initialValue={prompt?.initial ?? ""}
          confirmLabel={prompt?.kind === "rename" ? "Rename" : "Create"}
          onClose={() => shell.getState().closePrompt()}
          onConfirm={(value) => submitPrompt(stores, value)}
        />
      </PaneBoundary>

      <PaneBoundary title="The error notifications crashed">
        <ErrorSurfaces
          errors={errors}
          notifications={notifications}
          version={version}
          onRequestStoragePermission={requestStoragePermission}
        />
      </PaneBoundary>
    </>
  )
}
