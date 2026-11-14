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
import { handleBack } from "./back"

/**
 * The IDE frame, Task 13. Layout only: every pane is a feature view and all
 * behaviour lives in the stores. The Android back button is mapped here.
 */
export function Shell({ info }: { info: AppInfo | null }) {
  const stores = useStores()
  const { shell, settings } = stores
  const view = useStore(shell, (state) => state.view)
  const terminalMounted = useStore(shell, (state) => state.terminalMounted)
  const userSettings = useStore(settings, (state) => state.settings)
  const { mode, setMode } = useTheme()

  // The settings store is the source of truth; the theme provider mirrors it.
  useEffect(() => {
    if (userSettings.appTheme !== mode) setMode(userSettings.appTheme)
  }, [userSettings.appTheme, mode, setMode])

  useEffect(() => {
    void stores.files.getState().refresh()
    void stores.files.getState().loadStorage()
    void stores.editor.getState().restoreSession()
  }, [stores])

  useEffect(() => {
    // Everything the handler needs is read from the stores on demand, so this
    // registers once instead of on every state change.
    window.__leocodeBack = () => handleBack(stores)
    return () => {
      delete window.__leocodeBack
    }
  }, [stores])

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
