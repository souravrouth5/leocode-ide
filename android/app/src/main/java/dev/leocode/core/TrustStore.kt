package dev.leocode.core

import java.io.File
import java.security.MessageDigest
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/** The project actions that need a trust decision (Task 26, §11). */
enum class TrustAction(val wire: String) {
    SCRIPT("script"),
    PIP("pip"),
    VENV("venv"),
    GIT_HOOKS("git-hooks");

    companion object {
        fun from(wire: String?): TrustAction? = entries.firstOrNull { it.wire == wire }
    }
}

@Serializable
data class TrustEntry(
    val project: String,
    val action: String,
    val fingerprint: String,
    val grantedAt: Long
)

@Serializable
data class TrustIndex(val entries: List<TrustEntry> = emptyList())

/**
 * Per-project trust decisions (Task 26).
 *
 * A decision remembers the fingerprint of the files it was made for, not just
 * the action: editing `requirements.txt` or the script, or changing the Git
 * hooks, invalidates the old grant and asks again. The file is small and
 * rewritten atomically; a corrupt index is treated as "nothing is trusted"
 * rather than failing every run.
 */
class TrustStore(
    private val file: File,
    private val json: Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    },
    private val clock: () -> Long = System::currentTimeMillis
) {

    fun check(project: String, action: TrustAction, fingerprint: String): Boolean {
        if (fingerprint.isBlank()) return false
        val entry = load().entries.firstOrNull {
            it.project == project && it.action == action.wire
        } ?: return false
        return entry.fingerprint == fingerprint
    }

    fun grant(project: String, action: TrustAction, fingerprint: String): TrustEntry {
        require(fingerprint.isNotBlank()) { "fingerprint is empty" }
        val entry = TrustEntry(project, action.wire, fingerprint, clock())
        val next = load().entries
            .filterNot { it.project == project && it.action == action.wire } + entry
        save(TrustIndex(next.sortedWith(compareBy({ it.project }, { it.action }))))
        return entry
    }

    fun revoke(project: String, action: TrustAction? = null) {
        val next = load().entries.filterNot {
            it.project == project && (action == null || it.action == action.wire)
        }
        save(TrustIndex(next))
    }

    fun list(): List<TrustEntry> = load().entries

    private fun load(): TrustIndex {
        if (!file.isFile) return TrustIndex()
        return runCatching { json.decodeFromString<TrustIndex>(file.readText()) }
            .getOrDefault(TrustIndex())
    }

    private fun save(index: TrustIndex) {
        file.parentFile?.mkdirs()
        AtomicWriter.write(file, (json.encodeToString(index) + "\n").toByteArray())
    }
}

/**
 * Hashes the files a trust decision is about.
 *
 * The digest includes a label and the project-relative name, so renaming a file
 * also invalidates the grant. Missing files are hashed as empty on purpose: a
 * grant made when `requirements.txt` did not exist must not cover a file that
 * appears later.
 */
object TrustFingerprint {

    fun compute(
        projectDir: File,
        action: TrustAction,
        path: String? = null,
        extra: String = ""
    ): String {
        val project = projectDir.canonicalFile
        val digest = MessageDigest.getInstance("SHA-256")

        fun add(label: String, bytes: ByteArray) {
            digest.update(label.toByteArray(Charsets.UTF_8))
            digest.update(0)
            digest.update(bytes)
            digest.update(0)
        }

        fun addFile(label: String, file: File) {
            val relative = runCatching { file.relativeTo(project).path }.getOrDefault(file.name)
            add("$label:$relative", if (file.isFile) file.readBytes() else ByteArray(0))
        }

        when (action) {
            TrustAction.SCRIPT -> {
                val scripts = if (!path.isNullOrBlank()) {
                    listOf(resolveInside(project, path))
                } else {
                    project.listFiles().orEmpty()
                        .filter { it.isFile && (it.name.endsWith(".py") || it.name.endsWith(".sh")) }
                        .sortedBy { it.name }
                }
                if (scripts.isEmpty()) add("script:<none>", ByteArray(0))
                scripts.forEach { addFile("script", it) }
            }

            TrustAction.PIP -> {
                addFile("pip", File(project, "requirements.txt"))
            }

            TrustAction.VENV -> {
                // The venv is derived from the runtime and the project path; a
                // grant does not survive moving the project or replacing Python.
                add("venv:project", project.path.toByteArray(Charsets.UTF_8))
                add("venv:runtime", extra.toByteArray(Charsets.UTF_8))
            }

            TrustAction.GIT_HOOKS -> {
                val hooks = File(project, ".git/hooks")
                val files = hooks.listFiles().orEmpty()
                    .filter { it.isFile && !it.name.endsWith(".sample") }
                    .sortedBy { it.name }
                if (files.isEmpty()) add("git-hooks:<none>", ByteArray(0))
                files.forEach { addFile("git-hooks", it) }
            }
        }

        return "sha256:" + digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun resolveInside(project: File, path: String): File {
        val candidate = File(path).let { if (it.isAbsolute) it else File(project, path) }
        val resolved = candidate.canonicalFile
        val root = project.canonicalFile
        if (resolved != root && !resolved.path.startsWith(root.path + File.separator)) {
            throw SecurityException("script is outside the project")
        }
        return resolved
    }
}
