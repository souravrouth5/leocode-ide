import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { Sidebar } from "../../components/Sidebar"
import { PaneBoundary } from "../../errors/PaneBoundary"

/** The explorer drawer, wired to the settings/files/editor stores. */
export function ExplorerDrawer({ version }: { version: string }) {
  const { files, editor, shell, settings } = useStores()
  const open = useStore(shell, (state) => state.sidebarOpen)
  const cwd = useStore(files, (state) => state.cwd)
  const entries = useStore(files, (state) => state.entries)
  const loading = useStore(files, (state) => state.loading)
  const storageInfo = useStore(files, (state) => state.storage)
  const docs = useStore(editor, (state) => state.docs)
  const activePath = useStore(editor, (state) => state.activePath)
  const userSettings = useStore(settings, (state) => state.settings)

  const addBookmark = (path: string) => {
    const current = userSettings.bookmarks || []
    if (current.includes(path)) return
    settings.getState().update({ bookmarks: [...current, path] })
    shell.getState().flash("Bookmark added")
  }

  return (
    <PaneBoundary title="The explorer drawer crashed">
      <Sidebar
        open={open}
        onClose={() => shell.getState().setSidebarOpen(false)}
        cwd={cwd}
        entries={entries}
        loading={loading}
        docs={docs}
        activePath={activePath}
        storageInfo={storageInfo}
        bookmarks={userSettings.bookmarks || []}
        recentFiles={userSettings.recentFiles || []}
        onOpenDoc={(path) => void editor.getState().openFile(path)}
        onCloseDoc={(path) => editor.getState().close(path)}
        onNavigate={(path) => files.getState().navigate(path)}
        onRefresh={() => void files.getState().refresh()}
        onCreate={(kind) =>
          shell.getState().openPrompt({
            kind,
            title: kind === "dir" ? "New folder" : "New file",
            label: kind === "dir" ? "Folder name" : "File name",
            initial: ""
          })
        }
        onRename={(entry) =>
          shell.getState().openPrompt({
            kind: "rename",
            title: "Rename",
            label: "New name",
            initial: entry.name,
            target: entry
          })
        }
        onDelete={(entry) => void editor.getState().deleteEntry(entry)}
        onOpenSaf={() => void editor.getState().openSafDocument()}
        onAddBookmark={addBookmark}
        onRemoveBookmark={(path) => {
          settings.getState().update({
            bookmarks: (userSettings.bookmarks || []).filter((item) => item !== path)
          })
          shell.getState().flash("Bookmark removed")
        }}
        onOpenSettings={() => shell.getState().setSettingsOpen(true)}
        onOpenTerminal={() => shell.getState().go("terminal")}
        onOpenRuntimes={() => shell.getState().go("runtimes")}
        onRequestStoragePermission={() => void files.getState().requestStoragePermission()}
        version={version}
      />
    </PaneBoundary>
  )
}
