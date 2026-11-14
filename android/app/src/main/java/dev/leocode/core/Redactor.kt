package dev.leocode.core

/**
 * Removes user-identifying details from diagnostics before they leave the app
 * (Task 8). Crash reports and the "Share diagnostics" action pass through here
 * first: absolute paths are replaced, and obvious credentials are masked.
 *
 * Redaction is deliberately conservative: it keeps enough structure to debug a
 * stack trace (class names, line numbers, method names) while dropping the
 * workspace paths, home directories and bearer tokens a user may have pasted
 * into a terminal. Over-redacting an unusual name is preferred to leaking a
 * credential (L-14).
 *
 * Shapes covered:
 *  - `NAME=value` / `NAME: value`, including underscore-joined names such as
 *    `GITHUB_TOKEN`, `DB_PASSWORD` and `AWS_SECRET_ACCESS_KEY`;
 *  - quoted JSON keys, `"token": "abc"` and `{'password':'p'}`;
 *  - Authorization headers (`Bearer`, `Basic`);
 *  - URL user-info, `https://user:pass@host`;
 *  - known token prefixes (`ghp_`, `github_pat_`, `sk-`, `AKIA…`, `xox[baprs]-`);
 *  - PEM private-key blocks, including a truncated one;
 *  - query credentials, `?token=…`;
 *  - absolute paths rooted at a well-known Android/Linux top level.
 */
object Redactor {

    private const val PATH_MASK = "<path>"
    private const val SECRET_MASK = "<redacted>"
    private const val KEY_MASK = "<redacted-private-key>"

    /** A path-looking token rooted at a well-known Android/Linux top level. */
    private val PATH = Regex(
        """(?<![\w:./-])/(?:data|storage|sdcard|system|mnt|home|tmp|proc|vendor|odm|product|apex|root)(?:/[^\s"'<>)|,;]+)*"""
    )

    /**
     * `password=hunter2`, `api_key: abc`, `token = xyz`, `GITHUB_TOKEN=…`,
     * `"token": "abc"`. The name may be joined with `_`, `-` or `.`, so a word
     * boundary is not required (and would be wrong: `\b` never matches between
     * `_` and a letter, which is how the old pattern missed `DB_PASSWORD`). The
     * separator may be wrapped in matching quotes, single or double, which is
     * what makes JSON bodies (`"token": "abc"`, `'password':'p'`) match.
     */
    private val SECRET_ASSIGNMENT = Regex(
        """(?i)([A-Za-z0-9_.-]*(?:password|passwd|passphrase|pass|token|secret|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)([^\s"',;&)}\]]+)"""
    )

    /** Authorization headers: Bearer and Basic credentials. */
    private val AUTH_SCHEME = Regex("""(?i)\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}""")

    /**
     * URL user-info: keeps the scheme and the user name (useful in a log), drops
     * the password. `https://user:pass@host` -> `https://user:<redacted>@host`.
     * A colon is required, so a plain `https://host@path` is untouched.
     */
    private val URL_USERINFO = Regex("""(?i)(\b[a-z][a-z0-9+.-]*://)([^/\s:@]+):([^/\s@]*)@""")

    /** Whole PEM private-key blocks, the header line included. */
    private val PEM_BLOCK = Regex(
        """-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----"""
    )

    /** A truncated PEM block (the crash cut the tail off) masks the rest of the text. */
    private val PEM_OPEN = Regex("""-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*""")

    /** Self-identifying credentials: they need no name or separator to be secrets. */
    private val TOKEN_PREFIX = Regex(
        """\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{8,})"""
    )

    /** Query strings that carry credentials: `?token=...`, `&key=...`. */
    private val SECRET_QUERY = Regex(
        """(?i)([?&](?:token|key|secret|password|auth|access_token|api_key)=)[^&\s]+"""
    )

    fun redact(text: String): String {
        var out = PATH.replace(text, PATH_MASK)
        out = PEM_BLOCK.replace(out, KEY_MASK)
        out = PEM_OPEN.replace(out, KEY_MASK)
        out = AUTH_SCHEME.replace(out) { "${it.groupValues[1]} $SECRET_MASK" }
        out = URL_USERINFO.replace(out) { "${it.groupValues[1]}${it.groupValues[2]}:$SECRET_MASK@" }
        out = TOKEN_PREFIX.replace(out, SECRET_MASK)
        out = SECRET_QUERY.replace(out) { "${it.groupValues[1]}$SECRET_MASK" }
        out = SECRET_ASSIGNMENT.replace(out) {
            "${it.groupValues[1]}${it.groupValues[2]}$SECRET_MASK"
        }
        return out
    }
}
