package dev.leocode.workspace

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption

/** One search hit, `search.match` in the bridge contract (Task 16). */
data class SearchMatch(
    val path: String,
    val line: Int,
    val col: Int,
    val preview: String
)

data class SearchResult(
    val count: Int,
    val truncated: Boolean
)

/**
 * Workspace-wide text search.
 *
 * Deliberately self-contained: no Git/JGit dependency, no background runtime.
 * Directories that only hold generated or vendored content (`.git`,
 * `node_modules`, `.venv`, `__pycache__`) are never entered. Files are scanned as
 * UTF-8 with a NUL-byte binary check, lines are reported 1-based, and the result
 * list is capped so a broad query cannot exhaust the WebView.
 *
 * [isCancelled] is polled between files and matches; the handler cancels through
 * `fs.search.cancel`.
 */
class SearchEngine(
    private val maxFileBytes: Long = 2L * 1024 * 1024,
    private val maxDepth: Int = 64
) {

    companion object {
        const val DEFAULT_MAX_RESULTS = 500
        const val HARD_MAX_RESULTS = 2_000
        val IGNORED_DIRECTORIES = setOf(
            ".git",
            ".hg",
            ".svn",
            "node_modules",
            ".venv",
            "venv",
            "__pycache__",
            ".gradle",
            "build",
            "dist",
            ".idea",
            ".trash",
            ".leocode-trash"
        )
    }

    fun search(
        root: File,
        query: String,
        glob: String? = null,
        maxResults: Int = DEFAULT_MAX_RESULTS,
        caseSensitive: Boolean = false,
        isCancelled: () -> Boolean = { false },
        onMatch: (SearchMatch) -> Unit = {}
    ): SearchResult {
        if (query.isEmpty()) return SearchResult(0, false)
        val cap = maxResults.coerceIn(1, HARD_MAX_RESULTS)
        val matcher = GlobMatcher(glob)
        val needle = if (caseSensitive) query else query.lowercase()
        var count = 0

        fun scan(file: File, relative: String, depth: Int): Boolean {
            if (isCancelled()) return false
            if (depth > maxDepth) return true
            if (file.isDirectory) {
                if (file.name in IGNORED_DIRECTORIES) return true
                if (Files.isSymbolicLink(file.toPath())) return true
                val children = try {
                    file.listFiles() ?: return true
                } catch (_: SecurityException) {
                    return true
                }
                for (child in children.sortedBy { it.name.lowercase() }) {
                    val childRelative = if (relative.isEmpty()) child.name else "$relative/${child.name}"
                    if (!scan(child, childRelative, depth + 1)) return false
                    if (count >= cap) return false
                }
                return true
            }
            if (!file.isFile || !matcher.matches(relative)) return true
            if (file.length() > maxFileBytes) return true
            if (!isText(file)) return true

            val text = try {
                file.readText(Charsets.UTF_8)
            } catch (_: IOException) {
                return true
            } catch (_: SecurityException) {
                return true
            }
            if (text.contains('\uFFFD')) {
                // readText replaces malformed bytes; do not search a binary as text.
                return true
            }
            var lineNumber = 1
            for (line in text.lineSequence()) {
                if (isCancelled()) return false
                val haystack = if (caseSensitive) line else line.lowercase()
                var index = haystack.indexOf(needle)
                while (index >= 0) {
                    count += 1
                    onMatch(
                        SearchMatch(
                            path = relative,
                            line = lineNumber,
                            col = index + 1,
                            preview = preview(line)
                        )
                    )
                    if (count >= cap) return false
                    index = haystack.indexOf(needle, index + needle.length.coerceAtLeast(1))
                }
                lineNumber += 1
            }
            return true
        }

        scan(root, "", 0)
        return SearchResult(count, truncated = count >= cap)
    }

    private fun preview(line: String): String {
        val trimmed = line.trim()
        return if (trimmed.length <= 240) trimmed else trimmed.take(237) + "…"
    }

    private fun isText(file: File): Boolean {
        if (!Files.isRegularFile(file.toPath(), LinkOption.NOFOLLOW_LINKS)) return false
        return try {
            file.inputStream().use { input ->
                val buffer = ByteArray(8 * 1024)
                val read = input.read(buffer)
                if (read <= 0) return true
                for (index in 0 until read) {
                    if (buffer[index] == 0.toByte()) return false
                }
                true
            }
        } catch (_: IOException) {
            false
        }
    }
}

/**
 * Tiny glob matcher for `fs.search`: `*`, `?` and `**`. A pattern without `/`
 * matches the file name; a pattern with `/` matches the relative path.
 */
internal class GlobMatcher(pattern: String?) {

    private val regex: Regex? = pattern
        ?.trim()
        ?.takeIf { it.isNotEmpty() }
        ?.let { compile(it) }

    private val matchPath = pattern?.contains('/') == true

    fun matches(relative: String): Boolean {
        val target = if (matchPath) relative else relative.substringAfterLast('/')
        return regex?.matches(target) ?: true
    }

    private fun compile(pattern: String): Regex {
        val out = StringBuilder("^")
        var index = 0
        while (index < pattern.length) {
            val ch = pattern[index]
            when (ch) {
                '*' -> {
                    if (index + 1 < pattern.length && pattern[index + 1] == '*') {
                        out.append(".*")
                        index += 1
                    } else {
                        out.append("[^/]*")
                    }
                }

                '?' -> out.append("[^/]")
                '.', '(', ')', '+', '|', '^', '$', '@', '%', '[', ']', '{', '}' ->
                    out.append('\\').append(ch)

                else -> out.append(ch)
            }
            index += 1
        }
        out.append('$')
        return Regex(out.toString(), RegexOption.IGNORE_CASE)
    }
}
