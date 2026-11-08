import { useEffect, useRef } from "react"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineDown,
  cursorLineUp,
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab
} from "@codemirror/commands"
import { python } from "@codemirror/lang-python"
import { bracketMatching, indentOnInput } from "@codemirror/language"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { Compartment, EditorState } from "@codemirror/state"
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  lineNumbers
} from "@codemirror/view"

interface Props {
  path: string
  initialContent: string
  dark: boolean
  onChange: (content: string) => void
  onSave: () => void
}

function editorTheme(dark: boolean) {
  const text = dark ? "#e6e9ef" : "#1c2027"
  const gutter = dark ? "#4b5468" : "#98a0ad"
  const activeLine = dark ? "rgba(255,255,255,0.035)" : "rgba(15,23,42,0.04)"
  const selection = dark ? "#2b3a5a" : "#cfe1ff"

  return EditorView.theme(
    {
      "&": {
        color: text,
        backgroundColor: "transparent",
        height: "100%",
        fontSize: "13.5px"
      },
      ".cm-content": {
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
        caretColor: dark ? "#7aa2f7" : "#2563eb",
        padding: "10px 0 40vh",
        lineHeight: "1.6"
      },
      ".cm-scroller": {
        WebkitOverflowScrolling: "touch"
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: gutter,
        border: "none",
        paddingRight: "6px"
      },
      ".cm-activeLine": { backgroundColor: activeLine },
      ".cm-activeLineGutter": { backgroundColor: activeLine, color: text },
      ".cm-selectionBackground, ::selection": { backgroundColor: selection },
      ".cm-cursor": { borderLeftColor: dark ? "#7aa2f7" : "#2563eb" },
      "&.cm-focused": { outline: "none" }
    },
    { dark }
  )
}

export function EditorPane({ path, initialContent, dark, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeRef = useRef(new Compartment())

  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  onChangeRef.current = onChange
  onSaveRef.current = onSave

  useEffect(() => {
    if (!host.current) return

    const state = EditorState.create({
      doc: initialContent,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        python(),
        EditorView.lineWrapping,
        keymap.of([
          {
            key: "Mod-s",
            preventDefault: true,
            run: () => {
              onSaveRef.current()
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
        }),
        themeRef.current.of(editorTheme(dark))
      ]
    })

    const view = new EditorView({ state, parent: host.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // The parent remounts this component per file, so `path` is only a guard.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Reconfigure the theme without destroying the document, selection or history.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: themeRef.current.reconfigure(editorTheme(dark))
    })
  }, [dark])

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

  return (
    <div className="editor-shell">
      <div className="editor-host" ref={host} />
      <div
        className="key-row"
        role="toolbar"
        aria-label="Editor keys"
        onPointerDown={(event) => event.preventDefault()}
      >
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
