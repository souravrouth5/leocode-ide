package dev.leocode.workspace

import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
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

    /**
     * Loads the index, creates the default workspace, rewrites missing dirs and
     * adopts directories that exist on disk but not in the index.
     *
     * A corrupt index is never overwritten: it is moved aside as
     * `workspaces.json.corrupt-<epochMillis>` and the directories under the
     * workspaces root are registered again, so a bad write cannot hide a user's
     * projects.
     */
    fun ensure() {
        synchronized(lock) {
            val loaded = readIndex()
            index = loaded ?: run {
                quarantineCorruptIndex()
                WorkspaceIndex()
            }
            index = index.copy(workspaces = adoptOrphanDirectories(index.workspaces))
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
        val dir = directory(allocated)
        val existed = dir.exists()
        ensureDirectory(allocated)
        val record = WorkspaceRecord(
            id = allocated,
            name = name,
            createdAt = now(),
            lastOpened = now()
        )
        val previous = index
        index = index.copy(workspaces = index.workspaces + record)
        try {
            persist()
        } catch (e: Exception) {
            // Roll back the record and the directory a failed persist would otherwise orphan.
            index = previous
            if (!existed) dir.delete()
            throw e
        }
        record
    }

    fun open(id: String): WorkspaceRecord = synchronized(lock) {
        val record = find(id) ?: throw NoSuchElementException("no such workspace")
        val previousIndex = index
        val previousActive = activeId
        val opened = record.copy(lastOpened = now())
        index = index.copy(
            active = opened.id,
            workspaces = index.workspaces.map { if (it.id == opened.id) opened else it }
        )
        activeId = opened.id
        ensureDirectory(opened.id)
        try {
            persist()
        } catch (e: Exception) {
            index = previousIndex
            activeId = previousActive
            throw e
        }
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

    /** Returns null when a present index file cannot be parsed; missing is an empty index. */
    private fun readIndex(): WorkspaceIndex? {
        if (!indexFile.exists()) return WorkspaceIndex()
        return try {
            json.decodeFromString(WorkspaceIndex.serializer(), indexFile.readText())
        } catch (_: SerializationException) {
            null
        } catch (_: IOException) {
            null
        }
    }

    /**
     * Moves an unparseable index aside. Throws instead of falling back to an
     * overwrite: losing the user's registry is worse than failing to start.
     */
    private fun quarantineCorruptIndex() {
        if (!indexFile.exists()) return
        val stamp = System.currentTimeMillis()
        var target = File(indexFile.parentFile, "${indexFile.name}.corrupt-$stamp")
        var attempt = 1
        while (target.exists()) {
            target = File(indexFile.parentFile, "${indexFile.name}.corrupt-$stamp-$attempt")
            attempt += 1
        }
        if (!indexFile.renameTo(target)) {
            throw IllegalStateException("cannot quarantine the corrupt workspace index")
        }
    }

    /**
     * Registers every real directory under [Workspace.workspacesRoot] whose name
     * is a valid workspace id but which has no record yet. This recovers a
     * quarantined index and adopts directories created outside the registry.
     */
    private fun adoptOrphanDirectories(
        records: List<WorkspaceRecord>
    ): List<WorkspaceRecord> {
        val dirs = try {
            workspace.workspacesRoot.listFiles()
        } catch (_: SecurityException) {
            null
        } ?: return records
        val known = records.mapTo(mutableSetOf()) { it.id }
        val adopted = records.toMutableList()
        for (dir in dirs.sortedBy { it.name }) {
            // A symlink is not a workspace directory: following one would point
            // the jail at a tree outside the app's private storage.
            if (!Files.isDirectory(dir.toPath(), LinkOption.NOFOLLOW_LINKS)) continue
            val id = try {
                sanitizeId(dir.name)
            } catch (_: IllegalArgumentException) {
                continue
            }
            if (id != dir.name || !known.add(id)) continue
            adopted += WorkspaceRecord(
                id = id,
                name = if (id == DEFAULT_ID) DEFAULT_NAME else dir.name,
                createdAt = dir.lastModified(),
                lastOpened = dir.lastModified()
            )
        }
        return adopted
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
