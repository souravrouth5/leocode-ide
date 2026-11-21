import { useCallback, useEffect, useRef, useState } from "react"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineDown,
  cursorLineUp,
  defaultKeymap,
  history,
  historyKeymap,
  indentLess,
  indentMore,
  indentWithTab,
  redo,
  selectAll,
  undo
} from "@codemirror/commands"
import { StreamLanguage, bracketMatching, indentOnInput } from "@codemirror/language"
import { cpp } from "@codemirror/lang-cpp"
import { css } from "@codemirror/lang-css"
import { html } from "@codemirror/lang-html"
import { java } from "@codemirror/lang-java"
import { javascript } from "@codemirror/lang-javascript"
import { json } from "@codemirror/lang-json"
import { markdown } from "@codemirror/lang-markdown"
import { php } from "@codemirror/lang-php"
import { python } from "@codemirror/lang-python"
import { rust } from "@codemirror/lang-rust"
import { sql } from "@codemirror/lang-sql"
import { xml } from "@codemirror/lang-xml"
import { yaml } from "@codemirror/lang-yaml"
import { shell } from "@codemirror/legacy-modes/mode/shell"
import {
  findNext,
  highlightSelectionMatches,
  openSearchPanel,
  replaceAll,
  replaceNext,
  searchKeymap,
  SearchQuery,
  setSearchQuery
} from "@codemirror/search"
import { Compartment, EditorState, type Extension } from "@codemirror/state"
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers
} from "@codemirror/view"
import { RedoIcon, RefreshIcon, SparklesIcon, UndoIcon } from "./Icons"
import type { FindReplaceCommand } from "../features/editor/commands"
import {
  EDITOR_THEMES,
  type EditorThemeId,
  getEditorThemeExtension
} from "./editorThemes"

export interface EditorPaneProps {
  path: string
  initialContent: string
  dark: boolean
  /**
   * One pane is mounted per open document (W-24); only the visible one handles
   * global editor commands, so Undo does not run against every hidden buffer.
   */
  active?: boolean
  fontSize?: number
  fontFamily?: string
  editorTheme?: EditorThemeId
  tabSize?: 2 | 4
  wordWrap?: boolean
  lineNumbers?: boolean
  formatOnSave?: boolean
  /** Large-file mode: show the chunk, but never let it be edited (Task 15). */
  readOnly?: boolean
  onChange: (content: string) => void
  onSave: () => void
  onReload?: () => void
  onNotification?: (message: string) => void
}

const THEME_STORAGE_KEY = "leocode.editor-theme"

export function getLanguageExtension(path: string): Extension {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return []
  const ext = path.slice(dot).toLowerCase()

  switch (ext) {
    case ".js":
    case ".mjs":
    case ".cjs":
      return javascript()
    case ".jsx":
      return javascript({ jsx: true })
    case ".ts":
      return javascript({ typescript: true })
    case ".tsx":
      return javascript({ jsx: true, typescript: true })
    case ".html":
    case ".htm":
      return html()
    case ".css":
      return css()
    case ".json":
      return json()
    case ".java":
      return java()
    case ".cpp":
    case ".cc":
    case ".c":
    case ".h":
    case ".hpp":
      return cpp()
    case ".md":
    case ".markdown":
      return markdown()
    case ".py":
      return python()
    case ".php":
    case ".phtml":
    case ".php3":
    case ".php4":
    case ".php5":
    case ".phps":
      return php()
    case ".rs":
      return rust()
    case ".sql":
      return sql()
    case ".xml":
    case ".svg":
      return xml()
    case ".yml":
    case ".yaml":
      return yaml()
    case ".sh":
    case ".bash":
    case ".zsh":
      return StreamLanguage.define(shell)
    default:
      return []
  }
}

export function getPrettierParser(path: string): string | null {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return null
  const ext = path.slice(dot).toLowerCase()

  switch (ext) {
    case ".js":
    case ".mjs":
    case ".cjs":
    case ".jsx":
      return "babel"
    case ".ts":
    case ".tsx":
      return "babel-ts"
    case ".json":
      return "json"
    case ".html":
    case ".htm":
      return "html"
    case ".css":
      return "css"
    case ".md":
    case ".markdown":
      return "markdown"
    default:
      return null
  }
}

let prettierLoader: Promise<[
  typeof import("prettier/standalone"),
  typeof import("prettier/plugins/babel"),
  typeof import("prettier/plugins/estree"),
  typeof import("prettier/plugins/html"),
  typeof import("prettier/plugins/postcss"),
  typeof import("prettier/plugins/markdown")
]> | null = null

function loadPrettier() {
  if (!prettierLoader) {
    prettierLoader = Promise.all([
      import("prettier/standalone"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
      import("prettier/plugins/html"),
      import("prettier/plugins/postcss"),
      import("prettier/plugins/markdown")
    ])
  }
  return prettierLoader
}

export async function formatDocument(
  view: EditorView,
  path: string
): Promise<{ success: boolean; message?: string }> {
  const parser = getPrettierParser(path)
  if (!parser) {
    return {
      success: false,
      message: "No Prettier parser for this file type"
    }
  }

  const currentText = view.state.doc.toString()
  const cursorOffset = view.state.selection.main.head

  try {
    const [prettier, babel, estree, htmlPlugin, postcss, markdownPlugin] =
      await loadPrettier()

    const plugins = [
      babel,
      estree,
      htmlPlugin,
      postcss,
      markdownPlugin
    ] as unknown as (string | import("prettier").Plugin)[]

    const result = await prettier.formatWithCursor(currentText, {
      parser,
      plugins,
      cursorOffset,
      tabWidth: 2,
      singleQuote: false,
      semi: true
    })

    if (result.formatted !== currentText) {
      view.dispatch({
        changes: { from: 0, to: currentText.length, insert: result.formatted },
        selection: {
          anchor: Math.min(result.cursorOffset, result.formatted.length)
        }
      })
      return { success: true, message: "Formatted" }
    }
    return { success: true, message: "Already formatted" }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, message: `Format error: ${msg}` }
  }
}

function resolveInitialTheme(dark: boolean): EditorThemeId {
  const saved = localStorage.getItem(THEME_STORAGE_KEY) as EditorThemeId | null
  if (saved && EDITOR_THEMES.some((t) => t.id === saved)) {
    return saved
  }
  return dark ? "tokyo-night" : "github-light"
}

export function EditorPane({
  path,
  initialContent,
  dark,
  active = true,
  fontSize = 14,
  fontFamily = "'JetBrains Mono', monospace",
  editorTheme: propEditorTheme,
  tabSize = 2,
  wordWrap = true,
  lineNumbers: showLineNumbers = true,
  formatOnSave = false,
  readOnly = false,
  onChange,
  onSave,
  onReload,
  onNotification
}: EditorPaneProps) {
  const host = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  const themeCompartment = useRef(new Compartment())
  const languageCompartment = useRef(new Compartment())
  const lineWrappingCompartment = useRef(new Compartment())
  const lineNumbersCompartment = useRef(new Compartment())
  const tabSizeCompartment = useRef(new Compartment())
  const readOnlyCompartment = useRef(new Compartment())

  const effectiveTheme: EditorThemeId =
    propEditorTheme ?? resolveInitialTheme(dark)

  const [currentTheme, setCurrentTheme] = useState<EditorThemeId>(effectiveTheme)
  const [formatting, setFormatting] = useState(false)

  useEffect(() => {
    if (propEditorTheme) {
      setCurrentTheme(propEditorTheme)
    }
  }, [propEditorTheme])

  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onReloadRef = useRef(onReload)
  const onNotificationRef = useRef(onNotification)
  const formatOnSaveRef = useRef(formatOnSave)

  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onReloadRef.current = onReload
  onNotificationRef.current = onNotification
  formatOnSaveRef.current = formatOnSave

  const handleFormat = useCallback(async () => {
    const view = viewRef.current
    if (!view) return
    setFormatting(true)
    try {
      const res = await formatDocument(view, path)
      if (res.message) {
        onNotificationRef.current?.(res.message)
      }
    } finally {
      setFormatting(false)
      view.focus()
    }
  }, [path])

  const handleFormatRef = useRef(handleFormat)
  handleFormatRef.current = handleFormat

  const handleSaveWithFormat = useCallback(async () => {
    if (formatOnSaveRef.current) {
      await handleFormatRef.current()
    }
    onSaveRef.current()
  }, [])

  // Initialize CodeMirror editor
  useEffect(() => {
    if (!host.current) return

    const normalizedInitial = (initialContent || "").replace(/\r\n/g, "\n")
    const state = EditorState.create({
      doc: normalizedInitial,
      extensions: [
        lineNumbersCompartment.current.of(showLineNumbers ? lineNumbers() : []),
        lineWrappingCompartment.current.of(
          wordWrap ? EditorView.lineWrapping : []
        ),
        tabSizeCompartment.current.of(EditorState.tabSize.of(tabSize)),
        readOnlyCompartment.current.of([
          EditorState.readOnly.of(readOnly),
          EditorView.editable.of(!readOnly)
        ]),
        highlightActiveLine(),
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        languageCompartment.current.of(getLanguageExtension(path)),
        themeCompartment.current.of(
          getEditorThemeExtension(currentTheme, fontSize, fontFamily)
        ),
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              void handleSaveWithFormat()
              return true
            }
          },
          {
            key: "Shift-Alt-f",
            preventDefault: true,
            run: () => {
              void handleFormatRef.current()
              return true
            }
          },
          {
            key: "Mod-Shift-f",
            preventDefault: true,
            run: () => {
              void handleFormatRef.current()
              return true
            }
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          indentWithTab
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString())
        })
      ]
    })

    const view = new EditorView({ state, parent: host.current })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Synchronize document if reloaded from disk / external update
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    if (currentDoc !== initialContent) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: initialContent }
      })
    }
  }, [initialContent])

  // Reconfigure language extension when path changes
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageCompartment.current.reconfigure(getLanguageExtension(path))
    })
  }, [path])

  // Reconfigure theme, font size, and font family when changed
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeCompartment.current.reconfigure(
        getEditorThemeExtension(currentTheme, fontSize, fontFamily)
      )
    })
  }, [currentTheme, fontSize, fontFamily])

  // Reconfigure line wrapping
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineWrappingCompartment.current.reconfigure(
        wordWrap ? EditorView.lineWrapping : []
      )
    })
  }, [wordWrap])

  // Reconfigure line numbers
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: lineNumbersCompartment.current.reconfigure(
        showLineNumbers ? lineNumbers() : []
      )
    })
  }, [showLineNumbers])

  // Reconfigure tab size
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: tabSizeCompartment.current.reconfigure(
        EditorState.tabSize.of(tabSize)
      )
    })
  }, [tabSize])

  // Reconfigure editing when large-file mode is entered or left
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: readOnlyCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly)
      ])
    })
  }, [readOnly])

  // Sync theme when app dark/light mode toggles (if user hasn't explicitly chosen a theme)
  const prevDarkRef = useRef(dark)
  useEffect(() => {
    if (prevDarkRef.current !== dark && !propEditorTheme) {
      prevDarkRef.current = dark
      const nextTheme: EditorThemeId = dark ? "tokyo-night" : "github-light"
      setCurrentTheme(nextTheme)
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme)
    }
  }, [dark, propEditorTheme])

  const handleThemeChange = (newTheme: EditorThemeId) => {
    setCurrentTheme(newTheme)
    localStorage.setItem(THEME_STORAGE_KEY, newTheme)
  }

  const insert = (text: string) => {
    const view = viewRef.current
    if (!view) return
    const { from, to } = view.state.selection.main
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length }
    })
    view.focus()
  }

  const command = (run: (view: EditorView) => boolean) => {
    const view = viewRef.current
    if (!view) return
    run(view)
    view.focus()
  }

  useEffect(() => {
    if (!active) return
    const handleCommand = (e: Event) => {
      const custom = e as CustomEvent<{ action: string; value?: unknown }>
      if (!custom.detail) return
      const view = viewRef.current
      if (!view) return
      // Large-file mode shows a truncated chunk; never mutate it through a menu
      // or the find/replace sheet (the buffer is not the whole file).
      const mutating =
        custom.detail.action === "format" ||
        custom.detail.action === "insert" ||
        custom.detail.action === "indent" ||
        custom.detail.action === "unindent" ||
        custom.detail.action === "undo" ||
        custom.detail.action === "redo" ||
        custom.detail.action === "replaceNext" ||
        custom.detail.action === "replaceAll"
      if (readOnly && mutating) return
      switch (custom.detail.action) {
        case "undo":
          undo(view)
          view.focus()
          break
        case "redo":
          redo(view)
          view.focus()
          break
        case "selectAll":
          selectAll(view)
          view.focus()
          break
        case "format":
          void handleFormat()
          break
        case "indent":
          indentMore(view)
          view.focus()
          break
        case "unindent":
          indentLess(view)
          view.focus()
          break
        case "search":
          openSearchPanel(view)
          view.focus()
          break
        case "gotoLine": {
          const lineNum = Number(custom.detail.value)
          if (!isNaN(lineNum) && lineNum > 0 && lineNum <= view.state.doc.lines) {
            const line = view.state.doc.line(lineNum)
            view.dispatch({
              selection: { anchor: line.from },
              scrollIntoView: true
            })
            view.focus()
          }
          break
        }
        case "gotoPosition": {
          const value = custom.detail.value as
            | { line?: number; col?: number; token?: string }
            | undefined
          const lineNum = Number(value?.line)
          const colNum = Math.max(1, Number(value?.col) || 1)
          if (!isNaN(lineNum) && lineNum > 0 && lineNum <= view.state.doc.lines) {
            const line = view.state.doc.line(lineNum)
            const position = Math.min(line.from + colNum - 1, line.to)
            view.dispatch({
              selection: { anchor: position },
              scrollIntoView: true
            })
            view.focus()
          }
          // Confirm the command was handled so a sender that retries until the
          // pane is mounted can stop (PD-17). An out-of-range line is still an
          // acknowledgement: retrying would never make it valid.
          const ack: { action: string; token?: string } = { action: "gotoPosition" }
          if (typeof value?.token === "string") ack.token = value.token
          window.dispatchEvent(new CustomEvent("leocode:editor-command-ack", { detail: ack }))
          break
        }
        case "findNext":
        case "replaceNext":
        case "replaceAll": {
          const value = custom.detail.value as FindReplaceCommand | undefined
          if (!value?.query) break
          const query = new SearchQuery({
            search: value.query,
            replace: value.replacement ?? "",
            caseSensitive: Boolean(value.caseSensitive),
            regexp: Boolean(value.regexp)
          })
          view.dispatch({ effects: setSearchQuery.of(query) })
          if (custom.detail.action === "findNext") findNext(view)
          else if (custom.detail.action === "replaceNext") replaceNext(view)
          else replaceAll(view)
          view.focus()
          break
        }
        case "insert": {
          if (custom.detail.value) insert(String(custom.detail.value))
          break
        }
      }
    }
    window.addEventListener("leocode:editor-command", handleCommand)
    return () => window.removeEventListener("leocode:editor-command", handleCommand)
  }, [handleFormat, active, readOnly])

  return (
    <div className="editor-shell">
      <div className="editor-host" ref={host} />
      <div
        className="key-row"
        role="toolbar"
        aria-label="Editor keys"
        onPointerDown={(event) => {
          // Allow click and focus on select elements
          if ((event.target as HTMLElement).tagName === "SELECT") return
          event.preventDefault()
        }}
      >
        <button
          className="key-icon"
          onClick={() => command(undo)}
          aria-label="Undo"
          title="Undo"
        >
          <UndoIcon size={17} />
        </button>
        <button
          className="key-icon"
          onClick={() => command(redo)}
          aria-label="Redo"
          title="Redo"
        >
          <RedoIcon size={17} />
        </button>
        <button
          className="key-btn"
          onClick={() => void handleFormat()}
          disabled={formatting}
          aria-label="Format document"
          title="Format code (Shift-Alt-F / Mod-Shift-F)"
        >
          <SparklesIcon size={15} />
          <span>Format</span>
        </button>
        {onReload && (
          <button
            className="key-btn"
            onClick={() => onReloadRef.current?.()}
            aria-label="Reload from disk"
            title="Reload from disk"
          >
            <RefreshIcon size={15} />
            <span>Reload</span>
          </button>
        )}
        <select
          className="theme-select"
          value={currentTheme}
          onChange={(e) => handleThemeChange(e.target.value as EditorThemeId)}
          aria-label="Editor theme"
          title="Select editor theme"
        >
          {EDITOR_THEMES.map((theme) => (
            <option key={theme.id} value={theme.id}>
              {theme.name}
            </option>
          ))}
        </select>
        <button onClick={() => insert("  ")}>Tab</button>
        <button onClick={() => command(cursorLineUp)} aria-label="Line up">
          ↑
        </button>
        <button onClick={() => command(cursorLineDown)} aria-label="Line down">
          ↓
        </button>
        <button onClick={() => command(cursorCharLeft)} aria-label="Left">
          ←
        </button>
        <button onClick={() => command(cursorCharRight)} aria-label="Right">
          →
        </button>
        <button onClick={() => insert("{")}>{"{"}</button>
        <button onClick={() => insert("}")}>{"}"}</button>
        <button onClick={() => insert("(")}>(</button>
        <button onClick={() => insert(")")}>)</button>
        <button onClick={() => insert('"')}>"</button>
        <button onClick={() => insert("'")}>'</button>
        <button onClick={() => insert(":")}>:</button>
        <button onClick={() => insert("/")}>/</button>
      </div>
    </div>
  )
}
