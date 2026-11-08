import { useEffect, useRef } from "react"
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands"
import { python } from "@codemirror/lang-python"
import { bracketMatching, indentOnInput } from "@codemirror/language"
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search"
import { EditorState } from "@codemirror/state"
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
  onChange: (content: string) => void
  onSave: () => void
}

const leoCodeTheme = EditorView.theme(
  {
    "&": {
      color: "#d7dae0",
      backgroundColor: "#12151c",
      height: "100%",
      fontSize: "13px"
    },
    ".cm-content": {
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
      caretColor: "#7aa2f7",
      padding: "8px 0"
    },
    ".cm-scroller": { lineHeight: "1.55" },
    ".cm-gutters": {
      backgroundColor: "#12151c",
      color: "#4b5263",
      border: "none",
      paddingRight: "6px"
    },
    ".cm-activeLine": { backgroundColor: "#1a1f2b" },
    ".cm-activeLineGutter": { backgroundColor: "#1a1f2b", color: "#8b93a7" },
    ".cm-selectionBackground, ::selection": { backgroundColor: "#2c3550" },
    ".cm-cursor": { borderLeftColor: "#7aa2f7" },
    "&.cm-focused": { outline: "none" }
  },
  { dark: true }
)

export function EditorPane({ path, initialContent, onChange, onSave }: Props) {
  const host = useRef<HTMLDivElement | null>(null)
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
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        leoCodeTheme
      ]
    })

    const view = new EditorView({ state, parent: host.current })
    return () => {
      view.destroy()
    }
    // Recreate per file: simplest correct behaviour for phase 1.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  return <div className="editor-host" ref={host} />
}
