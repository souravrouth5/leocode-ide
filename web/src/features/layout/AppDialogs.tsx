import { useEffect, useState } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { PromptDialog } from "../../components/PromptDialog"
import { RunSheet } from "../run/RunSheet"
import { SettingsDialog } from "../../components/SettingsDialog"
import { FindReplaceSheet } from "../../components/FindReplaceSheet"
import { SearchPanel } from "../../components/SearchPanel"
import { ErrorSurfaces } from "../../errors/ErrorSurfaces"
import { PaneBoundary } from "../../errors/PaneBoundary"
import { describeProgress } from "../workspace/backupStore"
import { DialogHost } from "../dialogs/DialogHost"
import { DiagnosticsSheet } from "../diagnostics/DiagnosticsSheet"
import { ConflictSheet } from "../git/ConflictSheet"
import { DiffSheet } from "../git/DiffSheet"
import { HostKeySheet } from "../git/HostKeySheet"
import { RemoteSheet } from "../git/RemoteSheet"
import { SshKeysSheet } from "../git/SshKeysSheet"
import { resetOnboarding } from "../onboarding/onboarding"
import { submitPrompt } from "../shell/promptActions"
import { UpdatesCard } from "../update/UpdatesCard"
import { RootWarningDialog } from "../root/RootWarningDialog"
import { retryRoot } from "../root/retryRoot"

/** All sheets/dialogs, wired to their stores. */
export function AppDialogs({ version }: { version: string }) {
  const stores = useStores()
  const { run, shell, settings, errors, notifications, files, bridge, editor, backup, dialogs, git } =
    stores
  const runState = useStore(run, (state) => state.run)
  const sheetOpen = useStore(run, (state) => state.sheetOpen)
  const prompt = useStore(shell, (state) => state.prompt)
  const settingsOpen = useStore(shell, (state) => state.settingsOpen)
  const userSettings = useStore(settings, (state) => state.settings)
  const storage = useStore(files, (state) => state.storage)
  const backupBusy = useStore(backup, (state) => state.busy)
  const backupStatus = useStore(backup, (state) => state.status)
  const recentErrors = useStore(errors, (state) => state.recent)
  const rootState = useStore(stores.root, (state) => state)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  useEffect(() => {
    stores.run.getState().bindRootStore?.(stores.root)
  }, [stores.run, stores.root])

  const requestStoragePermission = () => {
    void files.getState().requestStoragePermission()
  }

  const importFolder = async () => {
    backup.getState().begin("import", "Choose a folder…")
    try {
      const result = await bridge.importTree(null, (progress) =>
        backup.getState().update(describeProgress(progress), progress)
      )
      if (!result) {
        backup.getState().finish("Import cancelled")
        return
      }
      backup.getState().finish(`Imported ${result.files} files into ${result.path}`)
      notifications.getState().enqueue({
        kind: "success",
        message: `Imported ${result.files} files`,
        durationMs: 4_000
      })
      await files.getState().refresh()
    } catch (error) {
      errors.getState().report(error, { context: "Import folder" })
      backup.getState().fail()
    }
  }

  const exportBackup = async () => {
    backup.getState().begin("export", "Preparing backup…")
    try {
      const result = await bridge.exportWorkspace("leocode-backup.zip", (progress) =>
        backup.getState().update(describeProgress(progress), progress)
      )
      if (!result) {
        backup.getState().finish("Export cancelled")
        return
      }
      backup
        .getState()
        .finish(`Backed up ${result.files} files (${(result.bytes / 1024).toFixed(1)} KB)`)
      notifications.getState().enqueue({
        kind: "success",
        message: "Workspace backup exported",
        durationMs: 4_000
      })
    } catch (error) {
      errors.getState().report(error, { context: "Export backup" })
      backup.getState().fail()
    }
  }

  const restoreBackup = async () => {
    const confirmed = await dialogs.getState().confirm({
      title: "Restore from backup",
      message: "Restore a backup into the active workspace?",
      detail: "Files with the same name are replaced. Unrelated files are kept.",
      confirmLabel: "Restore",
      danger: true
    })
    if (!confirmed) return
    backup.getState().begin("restore", "Choose a backup…")
    try {
      const result = await bridge.restoreArchive((progress) =>
        backup.getState().update(describeProgress(progress), progress)
      )
      if (!result) {
        backup.getState().finish("Restore cancelled")
        return
      }
      backup
        .getState()
        .finish(`Restored ${result.files} files (${(result.bytes / 1024).toFixed(1)} KB)`)
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
      backup.getState().fail()
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
          rootLost={runState?.rootLost}
          onStop={() => run.getState().stop()}
          // Closing the sheet hides it; the process keeps running (W-12).
          onClose={() => run.getState().hide()}
          onRetryRoot={() => void run.getState().runFile()}
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
          onOpenSshKeys={() => {
            shell.getState().setSettingsOpen(false)
            void git.getState().openSshKeys()
          }}
          onOpenRemotes={() => {
            shell.getState().setSettingsOpen(false)
            void git.getState().openRemotes()
          }}
          onOpenDiagnostics={() => {
            shell.getState().setSettingsOpen(false)
            setDiagnosticsOpen(true)
          }}
          onShowOnboarding={() => {
            shell.getState().setSettingsOpen(false)
            resetOnboarding()
            shell.getState().openOnboarding()
          }}
          updatesCard={<UpdatesCard version={version} />}
          rootAvailable={rootState.available}
          rootEnabled={rootState.enabled}
          rootLoading={rootState.loading}
          onRequestRoot={() => stores.root.getState().openWarning()}
          onDisableRoot={async () => {
            try {
              await stores.root.getState().disableRoot()
            } catch (err) {
              stores.errors.getState().report(err, { context: "Disable root" })
            }
          }}
        />
      </PaneBoundary>

      <PaneBoundary title="Root warning crashed">
        <RootWarningDialog
          open={rootState.warningOpen}
          onClose={() => stores.root.getState().closeWarning()}
          onConfirm={async () => {
            await retryRoot(stores)
          }}
          loading={rootState.loading}
        />
      </PaneBoundary>

      <PaneBoundary title="The diagnostics report crashed">
        <DiagnosticsSheet
          open={diagnosticsOpen}
          onClose={() => setDiagnosticsOpen(false)}
          bridge={bridge}
          recentErrors={recentErrors}
          version={version}
          onNotice={(message) => notifications.getState().enqueue({ kind: "info", message })}
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

      <PaneBoundary title="The dialog crashed">
        <DialogHost />
      </PaneBoundary>

      <PaneBoundary title="The Git sheets crashed">
        <DiffSheet />
        <ConflictSheet />
        <RemoteSheet />
        <SshKeysSheet />
        <HostKeySheet />
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
