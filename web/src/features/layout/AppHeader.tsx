import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { EditMenu, FileMenu, OverflowMenu } from "../../components/EditorMenus"
import { LeoCodeLogo, MenuIcon, PlayIcon } from "../../components/Icons"
import { baseName, isDirty } from "../editor/model"
import { editorCommand } from "../editor/commands"

/** App bar: brand, file/edit/overflow menus and the Run badge. */
export function AppHeader() {
  const { editor, run, shell, settings } = useStores()
  const docs = useStore(editor, (state) => state.docs)
  const activePath = useStore(editor, (state) => state.activePath)
  const runState = useStore(run, (state) => state.run)
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

  return (
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
            onClick={() => void run.getState().runFile()}
            disabled={runState?.running}
            aria-label={`Run ${baseName(activeDoc.path)}`}
            title={runState?.running ? "Running…" : "Run"}
          >
            <PlayIcon size={15} />
          </button>
        )}

        <OverflowMenu
          onSearch={() => editorCommand("search")}
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
  )
}
