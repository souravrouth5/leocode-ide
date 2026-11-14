/** Document model shared by the editor store, views and session restore. */

export interface OpenDoc {
  path: string
  content: string
  /** Content when last loaded or saved; null for new unsaved files. */
  saved: string | null
  isUntitled?: boolean
}

export const normalizeText = (text: string) => text.replace(/\r\n/g, "\n")

export const isDirty = (doc: OpenDoc): boolean => {
  if (doc.saved === null) return true
  return normalizeText(doc.content) !== normalizeText(doc.saved)
}

export const join = (base: string, name: string) => (base === "." ? name : `${base}/${name}`)

export const baseName = (path: string) => path.split("/").pop() ?? path

export const dirName = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "."

export const SESSION_KEY = "leocode.open-session"

export const initial = (path: string, raw: string): OpenDoc => {
  const content = normalizeText(raw)
  return { path, content, saved: content, isUntitled: false }
}
