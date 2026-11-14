import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { PromptDialog } from "../../components/PromptDialog"
import { RunSheet } from "../../components/RunSheet"
import { SettingsDialog } from "../../components/SettingsDialog"
import { ErrorSurfaces } from "../../errors/ErrorSurfaces"
import { PaneBoundary } from "../../errors/PaneBoundary"
import { submitPrompt } from "../shell/promptActions"

/** All sheets/dialogs, wired to their stores. */
export function AppDialogs({ version }: { version: string }) {
  const stores = useStores()
  const { run, shell, settings, errors, notifications, files, bridge } = stores
  const runState = useStore(run, (state) => state.run)
  const sheetOpen = useStore(run, (state) => state.sheetOpen)
  const prompt = useStore(shell, (state) => state.prompt)
  const settingsOpen = useStore(shell, (state) => state.settingsOpen)
  const userSettings = useStore(settings, (state) => state.settings)
  const storage = useStore(files, (state) => state.storage)

  const requestStoragePermission = () => {
    void files.getState().requestStoragePermission()
  }

  return (
    <>
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
