package dev.leocode.core

/**
 * The only environment variables children may see (Task 6).
 *
 * One builder for every process and PTY: app secrets, bridge handles and the
 * rest of the host environment never leak into a child.
 */
object ChildEnv {

    private val ALLOWED = setOf(
        "HOME",
        "TMPDIR",
        "TMP",
        "PATH",
        "PYTHONHOME",
        "LD_LIBRARY_PATH",
        "SSL_CERT_FILE",
        "TERM",
        "LANG",
        "PWD",
        "COLUMNS",
        "LINES"
    )

    /** Allowlisted keys from [base], with allowlisted [extra] values taking precedence. */
    fun build(
        base: Map<String, String>,
        extra: Map<String, String> = emptyMap()
    ): Map<String, String> {
        val out = LinkedHashMap<String, String>()
        for ((key, value) in base) {
            if (key in ALLOWED) out[key] = value
        }
        for ((key, value) in extra) {
            if (key in ALLOWED) out[key] = value
        }
        return out
    }
}
