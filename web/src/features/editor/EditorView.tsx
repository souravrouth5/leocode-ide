import { Suspense } from "react"
import { useStore } from "zustand"
import { useStores } from "../../app/stores"
import { CodeIcon, XIcon } from "../../components/Icons"
import { PaneError } from "../../errors/CrashScreen"
import { ErrorBoundary } from "../../errors/ErrorBoundary"
import { lazyWithRetry } from "../../errors/lazyWithRetry"
import { useTheme } from "../../theme/ThemeProvider"
import { baseName, isDirty } from "./model"

const EditorPane = lazyWithRetry(() =>
  import("../../components/EditorPane").then((module) => ({ default: module.EditorPane }))
)

export function EditorView() {
  const { editor, shell, settings } = useStores()
  const { effective } = useTheme()
  const dark = effective === "dark"
  const view = useStore(shell, (state) => state.view)
  const docs = useStore(editor, (state) => state.docs)
  const activePath = useStore(editor, (state) => state.activePath)
  const userSettings = useStore(settings, (state) => state.settings)
  const activeDoc = docs.find((doc) => doc.path === activePath) ?? null

  return (
    <section
      className={"view editor-view" + (view === "editor" ? " current" : "")}
      aria-hidden={view !== "editor"}
    >
      {docs.length > 0 && (
        <div className="tabs" role="tablist">
          {docs.map((doc) => (
            <div
              key={doc.path}
              className={
                "tab" +
                (doc.path === activePath ? " active" : "") +
                (isDirty(doc) ? " dirty" : "")
              }
              role="tab"
              aria-selected={doc.path === activePath}
              onClick={() => editor.getState().setActive(doc.path)}
            >
              <span className="tab-name">{baseName(doc.path)}</span>
              <button
                className="tab-close"
                aria-label={`Close ${baseName(doc.path)}`}
                onClick={(event) => {
                  event.stopPropagation()
                  editor.getState().close(doc.path)
                }}
              >
                <XIcon size={13} />
              </button>
            </div>
          ))}
          <button
            className="tab-add"
            onClick={() => editor.getState().newUntitled()}
            title="New file"
            aria-label="New file"
          >
            +
          </button>
        </div>
      )}

      {docs.length > 0 ? (
        <div className="editor-body">
          {/*
            One EditorPane per open document, hidden when inactive (W-24). The
            CodeMirror state (undo history, selection, scroll) survives a tab
            switch, and closing the tab unmounts its pane, so nothing leaks.
          */}
          {docs.map((doc) => {
            const active = doc.path === activePath
            return (
              <div
                key={doc.path}
                className="editor-pane-slot"
                aria-hidden={!active}
                style={{
                  display: active ? "flex" : "none",
                  flexDirection: "column",
                  flex: "1 1 auto",
                  minHeight: 0
                }}
              >
                <ErrorBoundary
                  resetKey={doc.path}
                  fallback={(error, reset) => (
                    <PaneError
                      error={error}
                      onRetry={reset}
                      onNotice={(message) => shell.getState().flash(message)}
                    />
                  )}
                >
                  <Suspense fallback={<div className="empty">Loading editor…</div>}>
                    <EditorPane
                      key={doc.path}
                      path={doc.path}
                      active={active}
                      initialContent={doc.content}
                      dark={dark}
                      fontSize={userSettings.fontSize}
                      fontFamily={userSettings.fontFamily}
                      editorTheme={userSettings.editorTheme}
                      tabSize={userSettings.tabSize}
                      wordWrap={userSettings.wordWrap}
                      lineNumbers={userSettings.lineNumbers}
                      formatOnSave={userSettings.formatOnSave}
                      onChange={(content) => editor.getState().setContent(doc.path, content)}
                      onSave={() => void editor.getState().save(doc.path)}
                      onReload={() => void editor.getState().reload(doc.path)}
                      onNotification={(message) => shell.getState().flash(message)}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="empty editor-empty">
          <CodeIcon size={32} />
          <p>No file open</p>
          <div style={{ display: "flex", gap: "10px", marginTop: "4px" }}>
            <button className="btn primary" onClick={() => shell.getState().setSidebarOpen(true)}>
              Open File Explorer
            </button>
            <button className="btn ghost" onClick={() => editor.getState().newUntitled()}>
              + New File
            </button>
          </div>
        </div>
      )}
      {docs.length > 0 && !activeDoc && (
        <div className="empty editor-empty">
          <p>No file selected</p>
        </div>
      )}
    </section>
  )
}
