package dev.leocode.bridge

import dev.leocode.core.AtomicWriter
import dev.leocode.core.FileHash
import dev.leocode.core.PathJail
import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.file.Files
import java.nio.file.LinkOption
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray

/**
 * `fs.*` methods, `docs/bridge-contract.md`.
 *
 * Pure JVM: paths come from [PathJail], writes go through [AtomicWriter] and
 * deletes through [Trash]. The Activity never sees a raw path.
 *
 * [activeRoot] is a function, not a fixed directory: Phase D lets the user switch
 * workspaces and every relative path must follow the active one. It defaults to
 * the original single workspace, so existing callers and tests are unchanged.
 */
class FsHandler(
    private val workspace: Workspace,
    private val jail: PathJail,
    private val trash: Trash,
    private val json: Json = BridgeJson.value,
    private val activeRoot: () -> File = { workspace.defaultWorkspace }
) : BridgeHandler {

    companion object {
        /**
         * Largest file `fs.read` returns. It matches `fs.write`, so the app can
         * always open what it wrote (S-09; reads used to stop at 2 MB).
         *
         * Memory cost of one read at the cap: 4 MB of bytes, the decoded String
         * (up to 2 bytes per char, so up to 8 MB for non-ASCII) and the JSON
         * reply that is then encoded (about another 4 MB while it is built).
         * Budget roughly 12–16 MB of heap for one 4 MB read on a bridge thread;
         * the transport cap is 8 MB, so the reply still fits.
         */
        private const val MAX_READ = 4 * 1024 * 1024
        private const val MAX_WRITE_BYTES = 4 * 1024 * 1024
        private const val READ_BUFFER = 64 * 1024
        private const val TRASH_DIR = ".trash"
        private const val SHARED_TRASH_DIR = ".leocode-trash"

        val METHODS = setOf(
            "fs.list", "fs.read", "fs.write", "fs.mkdir", "fs.rename", "fs.delete", "fs.stat"
        )
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "fs.list" -> list(pathOf(payload, method))
        "fs.read" -> {
            val request = json.decodePayload(ReadRequest.serializer(), payload, method)
            read(request.path, request.offset, request.maxBytes)
        }
        "fs.write" -> {
            val request = json.decodePayload(WriteRequest.serializer(), payload, method)
            write(request.path, request.content ?: "", request.expectedHash)
        }
        "fs.mkdir" -> mkdir(pathOf(payload, method))
        "fs.rename" -> {
            val request = json.decodePayload(RenameRequest.serializer(), payload, method)
            rename(request.from, request.to)
        }
        "fs.delete" -> delete(pathOf(payload, method))
        "fs.stat" -> stat(pathOf(payload, method))
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

    private fun read(rawPath: String?, offset: Long, maxBytes: Int): JsonElement {
        val file = resolve(rawPath)
        if (!file.exists()) throw BridgeException(ErrorCode.E_NOT_FOUND, "no such file")
        if (file.isDirectory) throw BridgeException(ErrorCode.E_NOT_DIR, "is a directory")
        // A FIFO, socket or device reports no length and blocks the reader until a
        // peer appears, which would park this bridge thread with no reply (S-03).
        if (!isRegularFile(file)) {
            throw BridgeException(ErrorCode.E_NOT_DIR, "not a regular file")
        }
        if (offset < 0L) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "offset must not be negative")
        val length = file.length()
        if (maxBytes <= 0 && length > MAX_READ) {
            throw BridgeException(ErrorCode.E_LIMIT, "file is larger than 4 MB")
        }
        if (maxBytes > MAX_READ) {
            throw BridgeException(ErrorCode.E_LIMIT, "chunk is larger than 4 MB")
        }
        if (offset > length) {
            throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "offset is past the end of the file")
        }

        val requested = if (maxBytes > 0) {
            minOf(maxBytes.toLong(), length - offset, MAX_READ.toLong()).toInt()
        } else {
            minOf(length, MAX_READ.toLong()).toInt()
        }
        val bytes = try {
            readRange(file, offset, requested)
        } catch (e: IOException) {
            throw BridgeException(ErrorCode.E_IO, "cannot read ${rel(file)}")
        }
        if (bytes.any { it == 0.toByte() }) {
            throw BridgeException(ErrorCode.E_BINARY, "binary file")
        }
        val complete = offset + bytes.size >= length
        val safeBytes = if (complete) bytes else trimIncompleteUtf8(bytes)
        // Strict: malformed UTF-8 is E_BINARY, never U+FFFD. Replacing the bytes
        // on read would write the replacements back on the next save (S-08).
        val content = decodeUtf8(safeBytes)
            ?: throw BridgeException(ErrorCode.E_BINARY, "file is not valid UTF-8")
        val nextOffset = if (offset + safeBytes.size >= length) -1L else offset + safeBytes.size
        return json.encodeToJsonElement(
            ReadReply.serializer(),
            ReadReply(
                path = rel(file),
                content = content,
                size = length,
                nextOffset = nextOffset,
                mtime = file.lastModified(),
                hash = FileHash.safeHash(file) ?: ""
            )
        )
    }

    private fun stat(rawPath: String?): JsonElement {
        val file = resolve(rawPath)
        if (!file.exists()) throw BridgeException(ErrorCode.E_NOT_FOUND, "no such file")
        val isDir = file.isDirectory
        if (!isDir && !isRegularFile(file)) {
            throw BridgeException(ErrorCode.E_NOT_DIR, "not a regular file")
        }
        return json.encodeToJsonElement(
            StatReply.serializer(),
            StatReply(
                path = rel(file),
                kind = if (isDir) "dir" else "file",
                size = if (isDir) 0L else file.length(),
                mtime = file.lastModified(),
                hash = if (isDir) "" else (FileHash.safeHash(file) ?: "")
            )
        )
    }

    private fun write(rawPath: String?, content: String, expectedHash: String?): JsonElement {
        val file = resolve(rawPath)
        val bytes = content.toByteArray(Charsets.UTF_8)
        if (bytes.size > MAX_WRITE_BYTES) {
            throw BridgeException(ErrorCode.E_LIMIT, "content is larger than 4 MB")
        }
        if (expectedHash != null) {
            // The editor's baseline is the whole file. A missing file with a
            // baseline is a conflict too: someone deleted it underneath us.
            if (!file.isFile) throw BridgeException(ErrorCode.E_CONFLICT, "file changed on disk")
            val current = FileHash.safeHash(file)
            if (current == null || current != expectedHash) {
                throw BridgeException(ErrorCode.E_CONFLICT, "file changed on disk")
            }
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
            WriteReply(
                path = rel(file),
                size = file.length(),
                mtime = file.lastModified(),
                hash = FileHash.safeHash(file) ?: ""
            )
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
        // Parent canonical, last name unresolved: renaming a link moves the link,
        // not what it points at (S-05).
        val from = resolveEntry(rawFrom)
        val to = resolveEntry(rawTo)
        if (!existsNoFollow(from)) throw BridgeException(ErrorCode.E_NOT_FOUND, "source does not exist")
        // Renaming the workspace root would leave no default workspace until the
        // next process start (S-13); the trash must stay where it is (S-02).
        if (from in protectedRoots()) {
            throw BridgeException(ErrorCode.E_PERMISSION, "refusing to rename root storage")
        }
        // On case-insensitive shared storage `to` already resolves to the source
        // for a case-only rename, so existence alone cannot mean "would overwrite"
        // (S-12). A link source is excluded: rename(2) would replace the target
        // with the link and leave a self-referential entry.
        val sameEntry = !isSymlink(from) && isSameFile(from, to)
        if (existsNoFollow(to) && !sameEntry) {
            throw BridgeException(ErrorCode.E_EXISTS, "target already exists")
        }
        val parent = to.parentFile ?: throw BridgeException(ErrorCode.E_IO, "target has no parent")
        if (!parent.exists() && !parent.mkdirs()) {
            throw BridgeException(ErrorCode.E_IO, "cannot create target parent")
        }
        if (!from.renameTo(to)) {
            // A case-only rename may still need two steps on case-insensitive
            // storage: move the entry aside, then onto the requested name.
            if (!sameEntry || !renameViaTemp(from, to)) {
                throw BridgeException(ErrorCode.E_IO, "rename failed")
            }
        }
        return json.encodeToJsonElement(
            RenameReply.serializer(),
            RenameReply(rel(from), rel(to))
        )
    }

    private fun delete(rawPath: String?): JsonElement {
        // The trash must receive the directory entry, not the link target it
        // resolves to (S-05).
        val target = resolveEntry(rawPath)
        if (!existsNoFollow(target)) throw BridgeException(ErrorCode.E_NOT_FOUND, "no such file")

        // Compare the entry path, not `canonicalFile`: removing a link is always
        // allowed, even when it points at protected storage.
        if (target in protectedRoots()) {
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
        workspace.workspacesRoot.listFiles()?.forEach { add(it.canonicalFile) }
        jail.sharedStorageRoot?.let { add(it.canonicalFile) }
        trash.directories().forEach { add(it.canonicalFile) }
    }

    private fun resolve(rawPath: String?): File = try {
        jail.resolve(rawPath ?: ".", activeRoot())
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "path is outside the allowed roots")
    }

    private fun resolveEntry(rawPath: String?): File = try {
        jail.resolveEntry(rawPath ?: ".", activeRoot())
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "path is outside the allowed roots")
    }

    /**
     * Relative to the active workspace, absolute for shared storage.
     *
     * The root is canonicalised on every call: [PathJail.resolve] returns
     * canonical paths, and on a device `filesDir` is `/data/user/0/...` while its
     * canonical form is `/data/data/...`, so comparing against the uncanonicalised
     * root made every reply absolute (S-04). Phase D switches this root when the
     * user opens another workspace.
     */
    private fun rel(file: File): String {
        val root = canonicalActiveRoot
        val target = file.absoluteFile.normalize()
        if (target == root) return "."
        val prefix = root.path + File.separator
        return if (target.path.startsWith(prefix)) {
            target.path.substring(prefix.length).replace(File.separatorChar, '/')
        } else {
            target.absolutePath
        }
    }

    private val canonicalActiveRoot: File
        get() = try {
            activeRoot().canonicalFile
        } catch (e: IOException) {
            activeRoot().absoluteFile
        }

    private fun isRegularFile(file: File): Boolean =
        runCatching { Files.isRegularFile(file.toPath()) }.getOrDefault(false)

    private fun isSymlink(file: File): Boolean =
        runCatching { Files.isSymbolicLink(file.toPath()) }.getOrDefault(false)

    /** Existence of the entry itself: a dangling link exists and can be deleted. */
    private fun existsNoFollow(file: File): Boolean =
        runCatching { Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS) }
            .getOrDefault(file.exists())

    private fun isSameFile(a: File, b: File): Boolean {
        if (a.absoluteFile.normalize() == b.absoluteFile.normalize()) return true
        return try {
            Files.isSameFile(a.toPath(), b.toPath())
        } catch (e: IOException) {
            false
        }
    }

    /** Reads at most [limit] bytes starting at [offset]. */
    private fun readRange(file: File, offset: Long, limit: Int): ByteArray {
        if (limit <= 0) return ByteArray(0)
        RandomAccessFile(file, "r").use { input ->
            input.seek(offset)
            val out = ByteArrayOutputStream(minOf(limit, READ_BUFFER))
            val buffer = ByteArray(minOf(READ_BUFFER, limit))
            var total = 0
            while (total < limit) {
                val read = input.read(buffer, 0, minOf(buffer.size, limit - total))
                if (read < 0) break
                out.write(buffer, 0, read)
                total += read
            }
            return out.toByteArray()
        }
    }

    /**
     * Drops a trailing partial multi-byte code point so a chunk never ends in
     * the middle of a character. The next chunk starts at the returned offset.
     */
    private fun trimIncompleteUtf8(bytes: ByteArray): ByteArray {
        if (bytes.isEmpty()) return bytes
        var start = bytes.size - 1
        while (start >= 0 && (bytes[start].toInt() and 0xC0) == 0x80) start--
        if (start < 0) return bytes
        val lead = bytes[start].toInt() and 0xFF
        val expected = when {
            lead and 0x80 == 0 -> 1
            lead and 0xE0 == 0xC0 -> 2
            lead and 0xF0 == 0xE0 -> 3
            lead and 0xF8 == 0xF0 -> 4
            else -> 1
        }
        val available = bytes.size - start
        return if (available < expected) bytes.copyOfRange(0, start) else bytes
    }

    /**
     * Strict UTF-8 decode: `null` for malformed input instead of replacement
     * characters. A leading BOM is kept as U+FEFF and round-trips, as before.
     */
    private fun decodeUtf8(bytes: ByteArray): String? = try {
        Charsets.UTF_8.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (e: CharacterCodingException) {
        null
    }

    /**
     * Renames through a unique intermediate name; used only when [from] and [to]
     * are the same entry (a case-only rename) and a direct rename failed.
     */
    private fun renameViaTemp(from: File, to: File): Boolean {
        val parent = from.parentFile ?: return false
        val aside = File(parent, ".${from.name}.${UUID.randomUUID()}.rename")
        if (!from.renameTo(aside)) return false
        if (aside.renameTo(to)) return true
        // Never leave the entry under the intermediate name.
        if (!aside.renameTo(from)) {
            throw BridgeException(ErrorCode.E_IO, "rename failed and the entry is left as ${rel(aside)}")
        }
        return false
    }

    private fun pathOf(payload: JsonObject, method: String): String? =
        json.decodePayload(PathRequest.serializer(), payload, method).path
}
