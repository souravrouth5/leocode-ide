/**
 * File/folder name validation for the prompt sheet (W-28).
 *
 * The host's path jail stops escapes, but a name containing `/` still creates a
 * nested path, `.` makes the "file" the folder itself, and `..` silently moves a
 * rename somewhere else. Reject those before the request is built.
 */

/** Most Linux filesystems cap a single name at 255 bytes. */
export const MAX_NAME_LENGTH = 255
/** Generous cap for a full path typed into Save As. */
export const MAX_PATH_LENGTH = 4096

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

const SEPARATOR = "A name cannot contain “/” or “\\”."
const CONTROL = "A name cannot contain control characters."
const RESERVED = "“.” and “..” are not valid names."

export function validateEntryName(raw: string): string | null {
  const name = raw.trim()
  if (!name) return "Enter a name."
  if (name === "." || name === "..") return RESERVED
  if (name.includes("/") || name.includes("\\")) return SEPARATOR
  if (CONTROL_CHARS.test(name)) return CONTROL
  if (name.length > MAX_NAME_LENGTH) {
    return `Names can be at most ${MAX_NAME_LENGTH} characters.`
  }
  return null
}

/** Save As accepts a bare name or a full path, so validate every segment. */
export function validatePathInput(raw: string): string | null {
  const path = raw.trim()
  if (!path) return "Enter a file name."
  if (CONTROL_CHARS.test(path)) return CONTROL
  if (path.length > MAX_PATH_LENGTH) return "That path is too long."

  const segments = path.split("/")
  if (path.startsWith("/")) segments.shift()
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return "Enter a valid path."
  }
  for (const segment of segments) {
    if (segment === "." || segment === "..") return RESERVED
    if (segment.length > MAX_NAME_LENGTH) {
      return `Each folder or file name can be at most ${MAX_NAME_LENGTH} characters.`
    }
  }
  return null
}
