import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { EditMenu, FileMenu, OverflowMenu } from "../../components/EditorMenus"
import { LeoCodeLogo, MenuIcon, PlayIcon } from "../../components/Icons"
import { PaneBoundary } from "../../errors/PaneBoundary"
import { baseName, isDirty } from "../editor/model"
import { editorCommand } from "../editor/commands"
import { WorkspaceSwitcher } from "../workspace/WorkspaceSwitcher"

/** App bar: brand, workspace switcher, file/edit/overflow menus and the Run badge. */
export function AppHeader() {
  const { editor, run, shell, settings, findReplace, search } = useStores()
  const docs = useStore(editor, (state) => state.docs)
  const activePath = useStore(editor, (state) => state.activePath)
  const runState = useStore(run, (state) => state.run)
  const starting = useStore(run, (state) => state.starting)
  const userSettings = useStore(settings, (state) => state.settings)
  const activeDoc = docs.find((doc) => doc.path === activePath) ?? null
  const activeDirty = activeDoc ? isDirty(activeDoc) : false

  const showStats = () => {
    if (!activeDoc) return
    const lines = activeDoc.content.split("\n").length
    const words = activeDoc.content.trim() ? activeDoc.content.trim().split(/\s+/).length : 0
    const chars = activeDoc.content.length
    shell
      .getState()
      .flash(
        `${lines} lines, ${words} words, ${chars} chars (${(chars / 1024).toFixed(1)} KB)`
      )
  }

  const selectSyntax = () => shell.getState().setSettingsOpen(true)
  const openSettings = () => shell.getState().setSettingsOpen(true)

  const runActive = () => {
    const state = run.getState()
    // A running (possibly hidden) job shows its output; otherwise start fresh.
    if (state.run?.running) state.show()
    else void state.runFile()
  }

  return (
    <PaneBoundary title="The app bar crashed">
      <header className="app-bar">
        <div className="brand">
          <button
            className="icon-btn sidebar-toggle-btn"
            onClick={() => shell.getState().toggleSidebar()}
            aria-label="Toggle explorer sidebar"
            title="Explorer (Files)"
          >
            <MenuIcon size={20} />
          </button>
          <LeoCodeLogo size={24} className="brand-logo" />
          <span className="brand-name">LeoCode</span>
        </div>
        <div className="app-bar-actions">
          <WorkspaceSwitcher />
          <FileMenu
            onNew={() => editor.getState().newUntitled()}
            onOpenExplorer={() => shell.getState().setSidebarOpen(true)}
            onOpenSaf={() => void editor.getState().openSafDocument()}
            onSave={() => void editor.getState().save()}
            onSaveAs={() => editor.getState().beginSaveAs()}
            onReload={() => void editor.getState().reload()}
            onCloseTab={() => activePath && editor.getState().close(activePath)}
            onCloseAllTabs={() => editor.getState().closeAll()}
            hasActiveDoc={activeDoc !== null}
            isDirty={activeDirty}
          />

          <EditMenu
            onUndo={() => editorCommand("undo")}
            onRedo={() => editorCommand("redo")}
            onSelectAll={() => editorCommand("selectAll")}
            onFormat={() => editorCommand("format")}
            onInsertDateTime={() => editorCommand("insert", new Date().toLocaleString())}
            onIndent={() => editorCommand("indent")}
            onUnindent={() => editorCommand("unindent")}
            hasActiveDoc={activeDoc !== null}
          />

          {activeDoc && (
            <button
              className="icon-btn run"
              onClick={runActive}
              // A second tap while the process is still spawning is ignored (W-14).
              disabled={starting}
              aria-label={
                runState?.running
                  ? `Show output for ${baseName(activeDoc.path)}`
                  : `Run ${baseName(activeDoc.path)}`
              }
              title={starting ? "Starting…" : runState?.running ? "Running…" : "Run"}
            >
              <PlayIcon size={15} />
            </button>
          )}

          <OverflowMenu
            onFindReplace={() => findReplace.getState().openSheet()}
            onSearchWorkspace={() => search.getState().setOpen(true)}
            onGotoLine={() => {
              const line = window.prompt("Goto line number:")
              if (line) editorCommand("gotoLine", line)
            }}
            onSelectSyntax={selectSyntax}
            onOpenSettings={openSettings}
            wordWrap={userSettings.wordWrap}
            onToggleWordWrap={() =>
              settings.getState().update({ wordWrap: !userSettings.wordWrap })
            }
            lineNumbers={userSettings.lineNumbers}
            onToggleLineNumbers={() =>
              settings.getState().update({ lineNumbers: !userSettings.lineNumbers })
            }
            onShowStatistics={showStats}
          />
        </div>
      </header>
    </PaneBoundary>
  )
}
