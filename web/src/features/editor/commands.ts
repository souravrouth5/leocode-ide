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

export function editorCommand(action: EditorCommand, value?: string): void {
  window.dispatchEvent(
    new CustomEvent("leocode:editor-command", {
      detail: value === undefined ? { action } : { action, value }
    })
  )
}
