import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { PromptDialog } from "../../components/PromptDialog"
import { RunSheet } from "../../components/RunSheet"
import { SettingsDialog } from "../../components/SettingsDialog"
import { ErrorSurfaces } from "../../errors/ErrorSurfaces"
import { submitPrompt } from "../shell/promptActions"

/** All sheets/dialogs, wired to their stores. */
export function AppDialogs({ version }: { version: string }) {
  const stores = useStores()
  const { run, shell, settings, errors, notifications, bridge } = stores
  const runState = useStore(run, (state) => state.run)
  const prompt = useStore(shell, (state) => state.prompt)
  const settingsOpen = useStore(shell, (state) => state.settingsOpen)
  const userSettings = useStore(settings, (state) => state.settings)

  return (
    <>
      <RunSheet
        open={runState !== null}
        title={runState?.title ?? ""}
        running={runState?.running ?? false}
        exitCode={runState?.exitCode ?? null}
        segments={runState?.segments ?? []}
        hint={runState?.hint}
        onStop={() => run.getState().stop()}
        onClose={() => run.getState().close()}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => shell.getState().setSettingsOpen(false)}
        settings={userSettings}
        onUpdate={(patch) => settings.getState().update(patch)}
        bridgeMode={bridge.mode}
        version={version}
        onOpenRuntimes={() => shell.getState().go("runtimes")}
      />

      <PromptDialog
        open={prompt !== null}
        title={prompt?.title ?? ""}
        label={prompt?.label}
        initialValue={prompt?.initial ?? ""}
        confirmLabel={prompt?.kind === "rename" ? "Rename" : "Create"}
        onClose={() => shell.getState().closePrompt()}
        onConfirm={(value) => void submitPrompt(stores, value)}
      />

      <ErrorSurfaces errors={errors} notifications={notifications} />
    </>
  )
}
