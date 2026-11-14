import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { FileTree } from "../../components/FileTree"
import { PaneBoundary } from "../../errors/PaneBoundary"

/** Explorer pane (the file list), Task 13. */
export function FilesView() {
  const { files, shell, editor } = useStores()
  const view = useStore(shell, (state) => state.view)
  const cwd = useStore(files, (state) => state.cwd)
  const entries = useStore(files, (state) => state.entries)
  const loading = useStore(files, (state) => state.loading)

  return (
    <section className={"view" + (view === "files" ? " current" : "")} aria-hidden={view !== "files"}>
      <PaneBoundary title="The file list crashed">
        <FileTree
          path={cwd}
          entries={entries}
          loading={loading}
          onOpen={(entry) => void editor.getState().openFile(entry.path)}
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
        />
      </PaneBoundary>
    </section>
  )
}
