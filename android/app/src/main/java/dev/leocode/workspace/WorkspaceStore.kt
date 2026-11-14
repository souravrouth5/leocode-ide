package dev.leocode.workspace

import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.File
import java.io.IOException
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

/** One project workspace, as exposed over `workspace.*` (Task 14). */
@Serializable
data class WorkspaceRecord(
    val id: String,
    val name: String,
    val createdAt: Long = 0L,
    val lastOpened: Long = 0L
)

@Serializable
private data class WorkspaceIndex(
    val active: String = WorkspaceStore.DEFAULT_ID,
    val workspaces: List<WorkspaceRecord> = emptyList()
)

/**
 * Persistent registry of project workspaces.
 *
 * Every workspace is a directory under [Workspace.workspacesRoot]. The index is a
 * single JSON file written atomically; names may be renamed without moving the
 * directory, so tabs and recent paths keep working. The active workspace is what
 * `fs.*` resolves relative paths against.
 *
 * Pure JVM: the Android layer only supplies the [Workspace] layout, the [Trash]
 * for deletion and a clock. Unit tests build the same object on a temp dir.
 */
class WorkspaceStore(
    private val workspace: Workspace,
    private val trash: Trash,
    private val json: Json = defaultJson(),
    private val now: () -> Long = { System.currentTimeMillis() },
    private val newId: () -> String = { UUID.randomUUID().toString().take(8) }
) {

    companion object {
        const val DEFAULT_ID = "default"
        const val DEFAULT_NAME = "Workspace"
        private const val INDEX_FILE = "workspaces.json"
        private const val MAX_NAME = 64

        fun defaultJson(): Json = Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }
    }

    private val lock = Any()
    private val indexFile = File(workspace.root, INDEX_FILE)
    private var index: WorkspaceIndex = WorkspaceIndex()
    @Volatile
    private var activeId: String = DEFAULT_ID

    /** Loads the index, creates the default workspace and repairs missing dirs. */
    fun ensure() {
        synchronized(lock) {
            val loaded = readIndex()
            index = if (loaded.workspaces.isEmpty()) {
                WorkspaceIndex(
                    active = DEFAULT_ID,
                    workspaces = listOf(
                        WorkspaceRecord(DEFAULT_ID, DEFAULT_NAME, now(), now())
                    )
                )
            } else {
                loaded
            }
            if (index.workspaces.none { it.id == DEFAULT_ID }) {
                index = index.copy(
                    workspaces = index.workspaces + WorkspaceRecord(
                        DEFAULT_ID,
                        DEFAULT_NAME,
                        now(),
                        now()
                    )
                )
            }
            activeId = index.active.takeIf { id -> index.workspaces.any { it.id == id } }
                ?: DEFAULT_ID
            for (record in index.workspaces) {
                ensureDirectory(record.id)
            }
            persist()
        }
    }

    fun list(): List<WorkspaceRecord> = synchronized(lock) {
        index.workspaces.sortedWith(
            compareByDescending<WorkspaceRecord> { it.id == DEFAULT_ID }
                .thenByDescending { it.lastOpened }
                .thenBy { it.name.lowercase() }
        )
    }

    fun activeId(): String = activeId

    fun active(): WorkspaceRecord = synchronized(lock) {
        index.workspaces.firstOrNull { it.id == activeId }
            ?: index.workspaces.first { it.id == DEFAULT_ID }
    }

    /** Directory of the active workspace; `fs.*` relative paths start here. */
    fun activeDirectory(): File = directory(activeId)

    fun directory(id: String): File =
        File(workspace.workspacesRoot, sanitizeId(id))

    /** Creates a workspace but does not switch to it, so the caller can confirm. */
    fun create(rawName: String): WorkspaceRecord = synchronized(lock) {
        val name = validateName(rawName)
        var id: String? = null
        for (attempt in 0 until 8) {
            val candidate = sanitizeId(newId())
            if (index.workspaces.none { it.id == candidate }) {
                id = candidate
                break
            }
        }
        val allocated = id ?: throw IllegalArgumentException("cannot allocate a workspace id")
        ensureDirectory(allocated)
        val record = WorkspaceRecord(
            id = allocated,
            name = name,
            createdAt = now(),
            lastOpened = now()
        )
        index = index.copy(workspaces = index.workspaces + record)
        persist()
        record
    }

    fun open(id: String): WorkspaceRecord = synchronized(lock) {
        val record = find(id) ?: throw NoSuchElementException("no such workspace")
        val opened = record.copy(lastOpened = now())
        index = index.copy(
            active = opened.id,
            workspaces = index.workspaces.map { if (it.id == opened.id) opened else it }
        )
        activeId = opened.id
        ensureDirectory(opened.id)
        persist()
        opened
    }

    fun rename(id: String, rawName: String): WorkspaceRecord = synchronized(lock) {
        val name = validateName(rawName)
        val record = find(id) ?: throw NoSuchElementException("no such workspace")
        val renamed = record.copy(name = name)
        index = index.copy(
            workspaces = index.workspaces.map { if (it.id == id) renamed else it }
        )
        persist()
        renamed
    }

    /**
     * Deletes a workspace by moving its directory to the trash. The default
     * workspace is permanent; deleting the active one falls back to default.
     */
    fun delete(id: String): Boolean = synchronized(lock) {
        val safeId = sanitizeId(id)
        if (safeId == DEFAULT_ID) throw SecurityException("the default workspace cannot be deleted")
        val record = find(safeId) ?: throw NoSuchElementException("no such workspace")
        val dir = directory(record.id)
        if (dir.exists()) {
            try {
                trash.move(dir)
            } catch (e: IOException) {
                throw IOException("cannot move the workspace to the trash", e)
            }
        }
        index = index.copy(
            active = if (activeId == record.id) DEFAULT_ID else index.active,
            workspaces = index.workspaces.filterNot { it.id == record.id }
        )
        activeId = index.active
        persist()
        true
    }

    private fun find(id: String): WorkspaceRecord? {
        val safe = sanitizeId(id)
        return index.workspaces.firstOrNull { it.id == safe }
    }

    private fun ensureDirectory(id: String) {
        val dir = directory(id)
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
            throw IllegalStateException("cannot create workspace ${dir.absolutePath}")
        }
    }

    private fun validateName(raw: String): String {
        val name = raw.trim()
        if (name.isEmpty()) throw IllegalArgumentException("a workspace needs a name")
        if (name.length > MAX_NAME) throw IllegalArgumentException("name is too long")
        if (name == "." || name == "..") throw IllegalArgumentException("invalid name")
        if (name.any { it == '/' || it == '\\' || it == '\u0000' }) {
            throw IllegalArgumentException("name contains a path separator")
        }
        return name
    }

    /** Ids become directory names, so only a conservative alphabet is allowed. */
    private fun sanitizeId(raw: String): String {
        val id = raw.trim()
        if (id.isEmpty() || id.length > 64) throw IllegalArgumentException("invalid workspace id")
        if (!id.all { it.isLetterOrDigit() || it == '-' || it == '_' }) {
            throw IllegalArgumentException("invalid workspace id")
        }
        return id
    }

    private fun readIndex(): WorkspaceIndex {
        if (!indexFile.isFile) return WorkspaceIndex()
        return try {
            json.decodeFromString(WorkspaceIndex.serializer(), indexFile.readText())
        } catch (_: SerializationException) {
            WorkspaceIndex()
        } catch (_: IOException) {
            WorkspaceIndex()
        }
    }

    private fun persist() {
        val text = json.encodeToString(
            WorkspaceIndex.serializer(),
            WorkspaceIndex(active = activeId, workspaces = index.workspaces)
        )
        val parent = indexFile.parentFile ?: workspace.root
        if (!parent.isDirectory && !parent.mkdirs() && !parent.isDirectory) {
            throw IllegalStateException("cannot create ${parent.absolutePath}")
        }
        try {
            dev.leocode.core.AtomicWriter.write(indexFile, text.toByteArray(Charsets.UTF_8))
        } catch (e: IOException) {
            throw IllegalStateException("cannot save the workspace index", e)
        }
    }
}
