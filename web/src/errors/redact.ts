/**
 * Redaction for every text that reaches a user-visible sink (W-09, plan §7.5).
 *
 * Host failures can carry paths (`E_IO: cannot write /storage/...`), pasted
 * output can carry credentials, and a JS `Error.message` can carry anything a
 * dependency printed. The web side mirrors `core/Redactor.kt` on the Android
 * side so "Copy details", the sheets, banners, snackbars and the run hint cannot
 * leak a token, a URL password or an absolute app path.
 *
 * Redaction is deliberately conservative: it keeps enough structure to debug a
 * failure (error code, method names, prose) while masking the value behind a
 * recognisable name, a known token prefix, a URL user-info section and paths
 * rooted at a well-known Android/Linux top level.
 */

export const REDACTED = "<redacted>"
export const REDACTED_PATH = "<path>"
export const REDACTED_PRIVATE_KEY = "<private key>"

/** `password`, `client_secret`, `api-key`, `access_key`, … */
const SECRET_WORDS = "password|passwd|pass|token|secret|api[_-]?key|access[_-]?key"

/** A complete PEM private-key block, including the PGP "BLOCK" label. */
const PEM_BLOCK =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g

/** A PEM header with no end marker (truncated log or message). */
const PEM_UNTERMINATED = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*$/g

/** `https://user:password@host` — the whole user-info section goes. */
const URL_USER_INFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

/** `Authorization: Bearer …`, `Basic …`. */
const AUTH_SCHEME = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi

/**
 * `GITHUB_TOKEN=…`, `DB_PASSWORD: …`, `api_key = …`, `"token": "abc"`.
 *
 * The name is any identifier containing a secret word, so prefixed host
 * variables (`AWS_SECRET_ACCESS_KEY`, `MY_API_KEY`) are covered. The separator
 * may be wrapped in quotes (JSON), and a quoted value keeps its quotes.
 */
const SECRET_ASSIGNMENT = new RegExp(
  `([A-Za-z0-9_]*(?:${SECRET_WORDS})[A-Za-z0-9_]*)(["']?\\s*[:=]\\s*)(?:(["'])([^"'\\n]*)\\3|([^\\s"',;]+))`,
  "gi"
)

/** Token shapes that are recognisable without a name in front of them. */
const TOKEN_PREFIXES: RegExp[] = [
  /\bghp_[A-Za-z0-9]{10,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{10,}/g,
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /\bxox[bap]-[A-Za-z0-9-]{8,}/g
]

/**
 * A path rooted at a well-known Android/Linux top level. The look-behind keeps
 * it from firing inside a URL path segment (`example.com/data`), and `:` stays
 * out of the path body so `E_IO: <path>: denied` keeps its punctuation.
 */
const ROOTED_PATH =
  /(?<![\w:./-])\/(?:data|storage|sdcard|system|mnt|home|tmp|proc|vendor|odm|product|apex|root)(?:\/[^\s"'<>)|,;:]*)*/g

/** Mask secrets and absolute paths in `text`. Never returns a raw credential. */
export function redact(text: string): string {
  if (!text) return text
  let out = text
  // Order matters: a PEM body is opaque, so it goes first and as a whole.
  out = out.replace(PEM_BLOCK, REDACTED_PRIVATE_KEY)
  out = out.replace(PEM_UNTERMINATED, REDACTED_PRIVATE_KEY)
  out = out.replace(URL_USER_INFO, `$1${REDACTED}@`)
  for (const pattern of TOKEN_PREFIXES) out = out.replace(pattern, REDACTED)
  out = out.replace(AUTH_SCHEME, `$1 ${REDACTED}`)
  out = out.replace(
    SECRET_ASSIGNMENT,
    (
      _match: string,
      name: string,
      separator: string,
      quote: string | undefined
    ) =>
      quote
        ? `${name}${separator}${quote}${REDACTED}${quote}`
        : `${name}${separator}${REDACTED}`
  )
  out = out.replace(ROOTED_PATH, REDACTED_PATH)
  return out
}

/** The message of anything thrown, without guessing at its type. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (error === null || error === undefined) return ""
  try {
    return String(error)
  } catch {
    // A hostile `toString` must not break an error sink.
    return ""
  }
}
