package dev.leocode.bridge

import dev.leocode.core.AtomicWriter
import dev.leocode.core.PathJail
import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import java.io.File
import java.io.IOException

/**
 * `fs.*` methods, `docs/bridge-contract.md`.
 *
 * Pure JVM: paths come from [PathJail], writes go through [AtomicWriter] and
 * deletes through [Trash]. The Activity never sees a raw path.
 */
class FsHandler(
    private val workspace: Workspace,
    private val jail: PathJail,
    private val trash: Trash,
    private val json: Json = BridgeJson.value
) : BridgeHandler {

    companion object {
        private const val MAX_READ = 2 * 1024 * 1024
        private const val MAX_WRITE_BYTES = 4 * 1024 * 1024
        private const val TRASH_DIR = ".trash"
        private const val SHARED_TRASH_DIR = ".leocode-trash"

        val METHODS = setOf(
            "fs.list", "fs.read", "fs.write", "fs.mkdir", "fs.rename", "fs.delete"
        )
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "fs.list" -> list(pathOf(payload, method))
        "fs.read" -> read(pathOf(payload, method))
        "fs.write" -> {
            val request = json.decodePayload(WriteRequest.serializer(), payload, method)
            write(request.path, request.content ?: "")
        }
        "fs.mkdir" -> mkdir(pathOf(payload, method))
        "fs.rename" -> {
            val request = json.decodePayload(RenameRequest.serializer(), payload, method)
            rename(request.from, request.to)
        }
        "fs.delete" -> delete(pathOf(payload, method))
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    // ------------------------------------------------------------------ methods

    private fun list(rawPath: String?): JsonArray {
        val dir = resolve(rawPath)
        if (!dir.exists()) throw BridgeException(ErrorCode.E_NOT_FOUND, "no such directory")
        if (!dir.isDirectory) throw BridgeException(ErrorCode.E_NOT_DIR, "not a directory")

        val visible = (dir.listFiles()?.toList() ?: emptyList())
            .filter { it.name != TRASH_DIR && it.name != SHARED_TRASH_DIR }
            .sortedWith(compareBy<File>({ !it.isDirectory }, { it.name.lowercase() }))

        return buildJsonArray {
            for (file in visible) {
                add(
                    json.encodeToJsonElement(
                        FileEntry.serializer(),
                        FileEntry(
                            name = file.name,
                            path = rel(file),
                            kind = if (file.isDirectory) "dir" else "file",
                            size = if (file.isFile) file.length() else 0L,
                            mtime = file.lastModified()
                        )
                    )
                )
            }
        }
    }

    private fun read(rawPath: String?): JsonElement {
        val file = resolve(rawPath)
        if (!file.exists()) throw BridgeException(ErrorCode.E_NOT_FOUND, "no such file")
        if (file.isDirectory) throw BridgeException(ErrorCode.E_NOT_DIR, "is a directory")
        if (file.length() > MAX_READ) {
            throw BridgeException(ErrorCode.E_LIMIT, "file is larger than 2 MB")
        }
        val bytes = file.readBytes()
        if (bytes.any { it == 0.toByte() }) {
            throw BridgeException(ErrorCode.E_BINARY, "binary file")
        }
        return json.encodeToJsonElement(
            ReadReply.serializer(),
            ReadReply(rel(file), String(bytes, Charsets.UTF_8), bytes.size)
        )
    }

    private fun write(rawPath: String?, content: String): JsonElement {
        val file = resolve(rawPath)
        val bytes = content.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_WRITE_BYTES) {
            throw BridgeException(ErrorCode.E_LIMIT, "content is larger than 4 MB")
        }
        val parent = file.parentFile ?: throw BridgeException(ErrorCode.E_IO, "path has no parent")
        if (!parent.exists() && !parent.mkdirs()) {
            throw BridgeException(ErrorCode.E_IO, "cannot create ${rel(parent)}")
        }
        try {
            AtomicWriter.write(file, bytes)
        } catch (e: IOException) {
            throw BridgeException(ErrorCode.E_IO, "cannot write ${rel(file)}")
        }
        return json.encodeToJsonElement(
            WriteReply.serializer(),
            WriteReply(rel(file), file.length())
        )
    }

    private fun mkdir(rawPath: String?): JsonElement {
        val dir = resolve(rawPath)
        if (dir.exists()) {
            if (!dir.isDirectory) throw BridgeException(ErrorCode.E_EXISTS, "a file already exists here")
            return json.encodeToJsonElement(PathReply.serializer(), PathReply(rel(dir)))
        }
        if (!dir.mkdirs()) throw BridgeException(ErrorCode.E_IO, "cannot create directory")
        return json.encodeToJsonElement(PathReply.serializer(), PathReply(rel(dir)))
    }

    private fun rename(rawFrom: String?, rawTo: String?): JsonElement {
        val from = resolve(rawFrom)
        val to = resolve(rawTo)
        if (!from.exists()) throw BridgeException(ErrorCode.E_NOT_FOUND, "source does not exist")
        // Renaming the workspace root would leave no default workspace until the
        // next process start (S-13); the trash must stay where it is (S-02).
        val protectedRoots = protectedRoots()
        if (from.canonicalFile in protectedRoots) {
            throw BridgeException(ErrorCode.E_PERMISSION, "refusing to rename root storage")
        }
        if (to.exists()) throw BridgeException(ErrorCode.E_EXISTS, "target already exists")
        val parent = to.parentFile ?: throw BridgeException(ErrorCode.E_IO, "target has no parent")
        if (!parent.exists() && !parent.mkdirs()) {
            throw BridgeException(ErrorCode.E_IO, "cannot create target parent")
        }
        if (!from.renameTo(to)) throw BridgeException(ErrorCode.E_IO, "rename failed")
        return json.encodeToJsonElement(
            RenameReply.serializer(),
            RenameReply(rel(from), rel(to))
        )
    }

    private fun delete(rawPath: String?): JsonElement {
        val target = resolve(rawPath)
        if (!target.exists()) throw BridgeException(ErrorCode.E_NOT_FOUND, "no such file")

        if (target.canonicalFile in protectedRoots()) {
            throw BridgeException(ErrorCode.E_PERMISSION, "refusing to delete root storage")
        }

        runCatching { trash.purge() }
        try {
            trash.move(target, jail.sharedStorageRoot)
        } catch (e: IOException) {
            throw BridgeException(ErrorCode.E_IO, "delete failed")
        }
        return json.encodeToJsonElement(DeleteReply.serializer(), DeleteReply(rel(target)))
    }

    // ------------------------------------------------------------------ helpers

    /** Roots that must never be renamed or deleted. Both trash dirs are included. */
    private fun protectedRoots(): Set<File> = buildSet {
        add(workspace.workspacesRoot.canonicalFile)
        add(workspace.defaultWorkspace.canonicalFile)
        jail.sharedStorageRoot?.let { add(it.canonicalFile) }
        trash.directories().forEach { add(it.canonicalFile) }
    }

    private fun resolve(rawPath: String?): File {
        val raw = rawPath ?: "."
        return try {
            jail.resolve(raw, workspace.defaultWorkspace)
        } catch (e: SecurityException) {
            throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "path is outside the allowed roots")
        }
    }

    /** Relative to the default workspace, absolute for shared storage. */
    private fun rel(file: File): String {
        val root = workspace.defaultWorkspace.normalize()
        val target = file.normalize()
        if (target == root) return "."
        val prefix = root.path + File.separator
        return if (target.path.startsWith(prefix)) {
            target.path.substring(prefix.length).replace(File.separatorChar, '/')
        } else {
            target.absolutePath
        }
    }

    private fun pathOf(payload: JsonObject, method: String): String? =
        json.decodePayload(PathRequest.serializer(), payload, method).path
}
