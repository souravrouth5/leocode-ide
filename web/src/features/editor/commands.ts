/** Editor commands travel to the mounted CodeMirror pane as window events. */

export type EditorCommand =
  | "undo"
  | "redo"
  | "selectAll"
  | "format"
  | "insert"
  | "indent"
  | "unindent"
  | "search"
  | "gotoLine"
  | "gotoPosition"
  | "findNext"
  | "replaceNext"
  | "replaceAll"

export interface FindReplaceCommand {
  query: string
  replacement: string
  caseSensitive: boolean
  regexp: boolean
}

export function editorCommand(action: EditorCommand, value?: unknown): void {
  window.dispatchEvent(
    new CustomEvent("leocode:editor-command", {
      detail: value === undefined ? { action } : { action, value }
    })
  )
}
