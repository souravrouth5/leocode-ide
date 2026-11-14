import { useEffect } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import type { AppInfo } from "../../bridge"
import { useTheme } from "../../theme/ThemeProvider"
import { EditorView } from "../editor/EditorView"
import { ExplorerDrawer } from "../files/ExplorerDrawer"
import { FilesView } from "../files/FilesView"
import { AppDialogs } from "../layout/AppDialogs"
import { AppHeader } from "../layout/AppHeader"
import { AppStatusBar } from "../layout/AppStatusBar"
import { BottomNav } from "../layout/BottomNav"
import { RuntimesView } from "../runtimes/RuntimesView"
import { TerminalView } from "../terminal/TerminalView"

/**
 * The IDE frame, Task 13. Layout only: every pane is a feature view and all
 * behaviour lives in the stores. The Android back button is mapped here.
 */
export function Shell({ info }: { info: AppInfo | null }) {
  const stores = useStores()
  const { shell, settings, files, editor, run } = stores
  const view = useStore(shell, (state) => state.view)
  const sidebarOpen = useStore(shell, (state) => state.sidebarOpen)
  const settingsOpen = useStore(shell, (state) => state.settingsOpen)
  const terminalMounted = useStore(shell, (state) => state.terminalMounted)
  const prompt = useStore(shell, (state) => state.prompt)
  const runOpen = useStore(run, (state) => state.run !== null)
  const userSettings = useStore(settings, (state) => state.settings)
  const { mode, setMode } = useTheme()

  // The settings store is the source of truth; the theme provider mirrors it.
  useEffect(() => {
    if (userSettings.appTheme !== mode) setMode(userSettings.appTheme)
  }, [userSettings.appTheme, mode, setMode])

  useEffect(() => {
    void files.getState().refresh()
    void files.getState().loadStorage()
    void editor.getState().restoreSession()
  }, [files, editor])

  useEffect(() => {
    window.__leocodeBack = () => {
      if (sidebarOpen) {
        shell.getState().setSidebarOpen(false)
        return true
      }
      if (runOpen) {
        run.getState().close()
        return true
      }
      if (prompt || settingsOpen) {
        shell.getState().closePrompt()
        shell.getState().setSettingsOpen(false)
        return true
      }
      if (view !== "editor") {
        shell.getState().setView("editor")
        return true
      }
      return false
    }
    return () => {
      delete window.__leocodeBack
    }
  }, [sidebarOpen, runOpen, prompt, settingsOpen, view, shell, run])

  return (
    <div className={"app" + (view === "editor" ? " view-editor" : "")}>
      <AppHeader />
      <main className="views">
        <FilesView />
        <EditorView />
        {terminalMounted && <TerminalView />}
        <RuntimesView info={info} />
      </main>
      <AppStatusBar />
      <BottomNav />
      <ExplorerDrawer version={info?.version ?? "0.1.0"} />
      <AppDialogs version={info?.version ?? "0.1.0"} />
    </div>
  )
}
