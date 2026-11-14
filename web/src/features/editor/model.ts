import type { Bridge } from "../../bridge"

/** Document model shared by the editor store, views and session restore. */

/** On-disk line ending for a document (W-18). */
export type Eol = "\n" | "\r\n"

export interface OpenDoc {
  path: string
  /** Always normalised to LF; `eol` is applied again when writing (W-18). */
  content: string
  /** Content when last loaded or saved (normalised); null for new unsaved files. */
  saved: string | null
  /** Line ending the file used on disk, restored on every write. */
  eol: Eol
  isUntitled?: boolean
}

export const normalizeText = (text: string) => text.replace(/\r\n/g, "\n")

/** Detect a file's line ending before normalising it. */
export const detectEol = (raw: string): Eol => (raw.includes("\r\n") ? "\r\n" : "\n")

/** Turn the normalised buffer back into the file's own line endings. */
export const serialize = (doc: Pick<OpenDoc, "content" | "eol">): string =>
  doc.eol === "\r\n" ? doc.content.replace(/\n/g, "\r\n") : doc.content

export const isDirty = (doc: OpenDoc): boolean => {
  if (doc.saved === null) return true
  return normalizeText(doc.content) !== normalizeText(doc.saved)
}

export const join = (base: string, name: string) => (base === "." ? name : `${base}/${name}`)

export const baseName = (path: string) => path.split("/").pop() ?? path

export const dirName = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "."

/** True when `path` is `root` itself or lives underneath it. */
export const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(root + "/")

/** Rewrite a path that lives under `from` so it lives under `to` instead. */
export const rewritePrefix = (path: string, from: string, to: string): string => {
  if (path === from) return to
  if (path.startsWith(from + "/")) return to + path.slice(from.length)
  return path
}

export const isSafPath = (path: string): boolean => path.startsWith("saf://")

export const SESSION_KEY = "leocode.open-session"

export const initial = (path: string, raw: string): OpenDoc => {
  const content = normalizeText(raw)
  return { path, content, saved: content, eol: detectEol(raw), isUntitled: false }
}

/**
 * True when the entry already exists. Listing the parent avoids `fs.write`
 * truncating an existing file (W-03/W-04).
 */
export async function entryExists(bridge: Bridge, path: string): Promise<boolean> {
  const parent = dirName(path)
  const name = baseName(path)
  try {
    const entries = await bridge.list(parent)
    return entries.some((entry) => entry.name === name)
  } catch {
    // A missing parent means nothing can collide with it yet.
    return false
  }
}
