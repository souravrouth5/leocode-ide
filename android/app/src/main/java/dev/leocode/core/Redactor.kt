package dev.leocode.core

/**
 * Removes user-identifying details from diagnostics before they leave the app
 * (Task 8). Crash reports and the "Share diagnostics" action pass through here
 * first: absolute paths are replaced, and obvious credentials are masked.
 *
 * Redaction is deliberately conservative: it keeps enough structure to debug a
 * stack trace (class names, line numbers, method names) while dropping the
 * workspace paths, home directories and bearer tokens a user may have pasted
 * into a terminal.
 */
object Redactor {

    /** A path-looking token rooted at a well-known Android/Linux top level. */
    private val PATH = Regex(
        """(?<![\w:./-])/(?:data|storage|sdcard|system|mnt|home|tmp|proc|vendor|odm|product|apex|root)(?:/[^\s"'<>)|,;]+)*"""
    )

    /** `password=hunter2`, `api_key: abc`, `token = xyz`. */
    private val SECRET_ASSIGNMENT = Regex(
        """(?i)\b(password|passwd|pass|token|secret|api[_-]?key|access[_-]?key)\b(\s*[:=]\s*)(\S+)"""
    )

    /** Authorization headers: Bearer and Basic credentials. */
    private val AUTH_SCHEME = Regex("""(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}""")

    /** Query strings that carry credentials: `?token=...`, `&key=...`. */
    private val SECRET_QUERY = Regex(
        """(?i)([?&](?:token|key|secret|password|auth|access_token|api_key)=)[^&\s]+"""
    )

    fun redact(text: String): String {
        var out = PATH.replace(text, "<path>")
        out = AUTH_SCHEME.replace(out) { "${it.groupValues[1]} <redacted>" }
        out = SECRET_QUERY.replace(out) { "${it.groupValues[1]}<redacted>" }
        out = SECRET_ASSIGNMENT.replace(out) { "${it.groupValues[1]}${it.groupValues[2]}<redacted>" }
        return out
    }
}
