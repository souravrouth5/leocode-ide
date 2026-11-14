package dev.leocode.bridge

import dev.leocode.workspace.ZipBackup
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * `saf.*` and `storage.*`, `docs/bridge-contract.md`.
 *
 * Everything except `storage.info` waits on the user, so all methods reply
 * asynchronously through [AsyncReply]. Cancelling a picker is a normal `null`
 * reply, not an error. Content is capped at 4 MB for both directions.
 *
 * Phase D adds folder copy-in (`saf.importTree`), a zip backup copy-out
 * (`saf.exportWorkspace`) and a safe restore (`saf.restoreArchive`). The heavy
 * work happens on a bridge thread; progress events are emitted through the
 * request's [StreamSink].
 */
class SafHandler(
    private val port: SafPort,
    private val json: Json = BridgeJson.value,
    /** Active workspace root for imports and backups. */
    private val workspaceRoot: () -> File = { File(".") },
    /** App-private scratch directory for temporary archives. */
    private val scratchRoot: () -> File = { File(System.getProperty("java.io.tmpdir") ?: ".") },
    private val backups: ZipBackup = ZipBackup()
) : AsyncBridgeHandler {

    companion object {
        private val METHODS = setOf(
            "saf.open",
            "saf.save",
            "saf.importTree",
            "saf.exportWorkspace",
            "saf.restoreArchive",
            "storage.info",
            "storage.requestPermission"
        )
        private const val MAX_WRITE_BYTES = 4 * 1024 * 1024
        private const val BACKUP_NAME = "leocode-backup.zip"
    }

    /**
     * One heavy SAF operation at a time: export, import and restore all walk the
     * same workspace and a restore during an export would bake a half-restored
     * tree into the backup. `saf.open`/`saf.save` are single-document and stay
     * unlocked.
     */
    private val backupLock = AtomicBoolean(false)

    override fun methods(): Set<String> = METHODS

    override fun handle(
        method: String,
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        when (method) {
            "storage.info" -> respond(
                AsyncReply.Ok(
                    json.encodeToJsonElement(StorageInfo.serializer(), port.storageInfo())
                )
            )

            "storage.requestPermission" -> port.requestStoragePermission { granted ->
                respond(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            StoragePermissionReply.serializer(),
                            StoragePermissionReply(granted)
                        )
                    )
                )
            }

            "saf.open" -> {
                val request = json.decodePayload(SafOpenRequest.serializer(), payload, method)
                port.openDocument(request.mime ?: "*/*") { result ->
                    val error = result.exceptionOrNull()
                    if (error != null) {
                        respond(AsyncReply.Error(safError(error), safMessage(error)))
                        return@openDocument
                    }
                    val document = result.getOrNull()
                    when {
                        document == null -> respond(AsyncReply.Ok(JsonNull))
                        document.size > MAX_WRITE_BYTES -> respond(
                            AsyncReply.Error(ErrorCode.E_LIMIT, "file is larger than 4 MB")
                        )
                        else -> respond(
                            AsyncReply.Ok(
                                json.encodeToJsonElement(
                                    SafOpenReply.serializer(),
                                    SafOpenReply(
                                        document.name,
                                        document.uri,
                                        document.content,
                                        document.size
                                    )
                                )
                            )
                        )
                    }
                }
            }

            "saf.save" -> {
                val request = json.decodePayload(SafSaveRequest.serializer(), payload, method)
                val name = request.name ?: "document.txt"
                val content = request.content ?: ""
                val size = content.toByteArray(Charsets.UTF_8).size
                if (size > MAX_WRITE_BYTES) {
                    throw BridgeException(ErrorCode.E_LIMIT, "content is larger than 4 MB")
                }
                port.saveDocument(name, content) { result ->
                    val error = result.exceptionOrNull()
                    if (error != null) {
                        respond(AsyncReply.Error(safError(error), safMessage(error)))
                        return@saveDocument
                    }
                    val uri = result.getOrNull()
                    respond(
                        AsyncReply.Ok(
                            if (uri == null) {
                                JsonNull
                            } else {
                                json.encodeToJsonElement(
                                    SafSaveReply.serializer(),
                                    SafSaveReply(name, uri)
                                )
                            }
                        )
                    )
                }
            }

            "saf.importTree" -> importTree(payload, respond, sink)
            "saf.exportWorkspace" -> exportWorkspace(payload, respond, sink)
            "saf.restoreArchive" -> restoreArchive(payload, respond, sink)

            else -> throw BridgeException(
                ErrorCode.E_UNKNOWN_METHOD,
                "unknown method: $method"
            )
        }
    }

    // ------------------------------------------------------------- Task 14

    private fun importTree(
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        withBackupLock(respond) { reply ->
            val request = json.decodePayload(SafImportRequest.serializer(), payload, "saf.importTree")
            port.importTree(
                request.dest,
                onProgress = { files, bytes ->
                    progress(sink, "import", files, bytes)
                },
                onResult = { result ->
                    val error = result.exceptionOrNull()
                    if (error != null) {
                        reply(AsyncReply.Error(safError(error), safMessage(error)))
                        return@importTree
                    }
                    val tree = result.getOrNull()
                    if (tree == null) {
                        reply(AsyncReply.Ok(JsonNull))
                        return@importTree
                    }
                    reply(
                        AsyncReply.Ok(
                            json.encodeToJsonElement(
                                SafImportReply.serializer(),
                                SafImportReply(tree.path, tree.files, tree.bytes)
                            )
                        )
                    )
                }
            )
        }
    }

    private fun exportWorkspace(
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        withBackupLock(respond) { reply ->
            val request = json.decodePayload(
                SafExportRequest.serializer(),
                payload,
                "saf.exportWorkspace"
            )
            val name = request.name?.takeIf { it.isNotBlank() } ?: BACKUP_NAME
            val archive = try {
                File(scratchDirectory(), "backup-${UUID.randomUUID()}.zip")
            } catch (e: IOException) {
                throw BridgeException(ErrorCode.E_IO, "cannot prepare the backup")
            }
            val counts = try {
                backups.export(workspaceRoot(), archive) { files, bytes ->
                    progress(sink, "export", files, bytes)
                }
            } catch (e: IOException) {
                archive.delete()
                throw BridgeException(ErrorCode.E_IO, "cannot create the backup")
            }
            port.exportArchive(name, archive, { _, bytes ->
                // The ZIP is already complete; report its file count, not the
                // copy-out's byte pacing (PD-21).
                progress(sink, "export", counts.files, bytes)
            }) { exportResult ->
                archive.delete()
                val error = exportResult.exceptionOrNull()
                if (error != null) {
                    reply(AsyncReply.Error(safError(error), safMessage(error)))
                    return@exportArchive
                }
                val uri = exportResult.getOrNull()
                if (uri == null) {
                    reply(AsyncReply.Ok(JsonNull))
                    return@exportArchive
                }
                reply(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            SafExportReply.serializer(),
                            SafExportReply(name, uri, counts.files, counts.bytes)
                        )
                    )
                )
            }
        }
    }

    private fun restoreArchive(
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        withBackupLock(respond) { reply ->
            val request = json.decodePayload(
                SafRestoreRequest.serializer(),
                payload,
                "saf.restoreArchive"
            )
            if (!request.confirm) {
                throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "confirmation is required")
            }
            port.openArchive { result ->
                val error = result.exceptionOrNull()
                if (error != null) {
                    reply(AsyncReply.Error(safError(error), safMessage(error)))
                    return@openArchive
                }
                val archive = result.getOrNull()
                if (archive == null) {
                    reply(AsyncReply.Ok(JsonNull))
                    return@openArchive
                }
                try {
                    val restored = backups.restore(
                        archive,
                        workspaceRoot(),
                        scratchDirectory()
                    ) { files, bytes ->
                        progress(sink, "restore", files, bytes)
                    }
                    reply(
                        AsyncReply.Ok(
                            json.encodeToJsonElement(
                                SafRestoreReply.serializer(),
                                SafRestoreReply(restored.files, restored.bytes)
                            )
                        )
                    )
                } catch (e: IOException) {
                    reply(AsyncReply.Error(ErrorCode.E_IO, "the backup could not be restored"))
                } finally {
                    archive.delete()
                }
            }
        }
    }

    private fun withBackupLock(
        respond: (AsyncReply) -> Unit,
        block: (reply: (AsyncReply) -> Unit) -> Unit
    ) {
        if (!backupLock.compareAndSet(false, true)) {
            throw BridgeException(ErrorCode.E_BUSY, "another backup operation is running")
        }
        val released = AtomicBoolean(false)
        fun release() {
            if (released.compareAndSet(false, true)) backupLock.set(false)
        }
        val reply: (AsyncReply) -> Unit = { result ->
            release()
            respond(result)
        }
        try {
            block(reply)
        } catch (e: Throwable) {
            release()
            throw e
        }
    }

    private fun progress(sink: StreamSink, phase: String, files: Int, bytes: Long) {
        sink.event(
            "saf.progress",
            json.encodeToJsonElement(
                SafProgress.serializer(),
                SafProgress(phase, files, bytes)
            )
        )
    }

    private fun scratchDirectory(): File {
        val dir = scratchRoot()
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
            throw IOException("cannot create the scratch directory")
        }
        return dir
    }

    /** Fixed copy: never put provider paths or exception text on the wire (B-06). */
    private fun safError(error: Throwable): ErrorCode = when (error) {
        is SecurityException -> ErrorCode.E_PERMISSION
        is java.io.FileNotFoundException -> ErrorCode.E_NOT_FOUND
        is UnsupportedOperationException -> ErrorCode.E_UNSUPPORTED
        // The import budget throws these with a fixed, user-facing reason: "the
        // import exceeds the file or size limit" or "the folder is nested too
        // deeply" (PD-06). Anything else keeps the generic I/O message.
        is IllegalStateException -> ErrorCode.E_LIMIT
        is java.io.IOException -> ErrorCode.E_IO
        else -> ErrorCode.E_IO
    }

    private fun safMessage(error: Throwable): String = when (safError(error)) {
        ErrorCode.E_PERMISSION -> "the document provider denied access"
        ErrorCode.E_NOT_FOUND -> "the selected document is no longer available"
        ErrorCode.E_UNSUPPORTED -> "this build cannot use the system picker for that action"
        // Only the fixed import reasons reach here; they are not provider text.
        ErrorCode.E_LIMIT -> error.message ?: "the import exceeds the file or size limit"
        ErrorCode.E_IO -> "the document could not be read or written"
        else -> "the document could not be read or written"
    }
}
