package dev.leocode.workspace

import dev.leocode.core.AtomicWriter
import dev.leocode.core.FileHash
import java.io.File
import java.io.IOException
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/** One autosaved unsaved buffer (Task 15). */
@Serializable
data class DraftInfo(
    val path: String,
    val mtime: Long,
    val size: Int
)

@Serializable
data class Draft(
    val path: String,
    val content: String,
    val eol: String = "\n",
    val mtime: Long = 0L
)

/**
 * Autosaved editor drafts, keyed by workspace and document path.
 *
 * The web editor writes here three seconds after typing stops. Drafts live
 * outside the workspace tree so they survive a workspace delete only until the
 * next purge, and so a user never sees a `.drafts` folder in the explorer.
 * Filenames are SHA-256 of the document path: a bridge path may contain any
 * character a filesystem cannot use as a name.
 */
class Drafts(
    root: File,
    private val workspaceId: () -> String,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
    private val now: () -> Long = { System.currentTimeMillis() }
) {

    companion object {
        /** Same cap as `fs.write`; a draft must never be larger than the file it shadows. */
        const val MAX_BYTES = 4 * 1024 * 1024
        private const val EXT = ".json"
    }

    private val root = File(root, "drafts")
    private val lock = Any()

    fun list(): List<DraftInfo> = synchronized(lock) {
        val dir = directory()
        (dir.listFiles() ?: return emptyList())
            .asSequence()
            .filter { it.isFile && it.name.endsWith(EXT) }
            .mapNotNull { file -> readFile(file)?.let { draft -> DraftInfo(draft.path, draft.mtime, draft.content.length) } }
            .sortedByDescending { it.mtime }
            .toList()
    }

    fun read(path: String): Draft? = synchronized(lock) {
        readFile(fileFor(path))
    }

    fun save(path: String, content: String, eol: String = "\n"): Draft = synchronized(lock) {
        if (path.isBlank()) throw IllegalArgumentException("a draft needs a path")
        if (content.toByteArray(Charsets.UTF_8).size > MAX_BYTES) {
            throw IllegalArgumentException("draft is larger than 4 MB")
        }
        val dir = directory()
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
            throw IOException("cannot create the drafts directory")
        }
        val draft = Draft(
            path = path,
            content = content,
            eol = if (eol == "\r\n") "\r\n" else "\n",
            mtime = now()
        )
        val file = fileFor(path)
        try {
            AtomicWriter.write(file, json.encodeToString(Draft.serializer(), draft).toByteArray(Charsets.UTF_8))
        } catch (e: IOException) {
            throw IOException("cannot save the draft", e)
        }
        draft
    }

    fun delete(path: String): Boolean = synchronized(lock) {
        val file = fileFor(path)
        file.isFile && file.delete()
    }

    /** Deletes every draft that belongs to a workspace, e.g. after a workspace delete. */
    fun deleteWorkspace(id: String): Int = synchronized(lock) {
        val dir = directory(id)
        (dir.listFiles() ?: return 0).count { it.isFile && it.delete() }
    }

    private fun directory(id: String = workspaceId()): File = File(root, safeComponent(id))

    private fun fileFor(path: String): File =
        File(directory(), FileHash.sha256(path) + EXT)

    private fun readFile(file: File): Draft? {
        if (!file.isFile) return null
        return try {
            json.decodeFromString(Draft.serializer(), file.readText())
        } catch (_: SerializationException) {
            null
        } catch (_: IOException) {
            null
        }
    }

    private fun safeComponent(raw: String): String =
        raw.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.ifEmpty { "default" }
}
