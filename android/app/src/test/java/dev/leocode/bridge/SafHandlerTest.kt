package dev.leocode.bridge

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SafHandlerTest {

    private class FakePort(
        var document: SafDocument? = null,
        var savedUri: String? = "content://saved",
        var granted: Boolean = true
    ) : SafPort {
        var lastMime: String? = null
        var lastSaveName: String? = null
        var lastSaveContent: String? = null

        override fun storageInfo(): StorageInfo = StorageInfo(
            hasPermission = granted,
            internalStorage = "/storage/emulated/0",
            downloads = "/storage/emulated/0/Download",
            documents = "/storage/emulated/0/Documents",
            workspace = "/data/data/dev.leocode/files/workspaces/default"
        )

        override fun requestStoragePermission(callback: (Boolean) -> Unit) {
            callback(granted)
        }

        var openFailure: Throwable? = null
        var saveFailure: Throwable? = null
        var treeResult: SafTreeResult? = SafTreeResult("dest", 2, 10)
        var treeFailure: Throwable? = null
        var importDest: String? = null
        var exportName: String? = null
        var exportFailure: Throwable? = null
        var exportedZip: ByteArray? = null
        var archiveToOpen: java.io.File? = null
        var openArchiveFailure: Throwable? = null
        var openArchiveCalls = 0

        override fun openDocument(mime: String, onResult: (Result<SafDocument?>) -> Unit) {
            lastMime = mime
            onResult(openFailure?.let { Result.failure(it) } ?: Result.success(document))
        }

        override fun saveDocument(
            name: String,
            content: String,
            onResult: (Result<String?>) -> Unit
        ) {
            lastSaveName = name
            lastSaveContent = content
            onResult(saveFailure?.let { Result.failure(it) } ?: Result.success(savedUri))
        }

        override fun importTree(
            dest: String?,
            onProgress: (files: Int, bytes: Long) -> Unit,
            onResult: (Result<SafTreeResult?>) -> Unit
        ) {
            importDest = dest
            onProgress(1, 5)
            onResult(treeFailure?.let { Result.failure(it) } ?: Result.success(treeResult))
        }

        override fun exportArchive(
            name: String,
            archive: java.io.File,
            onProgress: (files: Int, bytes: Long) -> Unit,
            onResult: (Result<String?>) -> Unit
        ) {
            exportName = name
            exportedZip = archive.readBytes()
            onProgress(1, 0)
            onResult(exportFailure?.let { Result.failure(it) } ?: Result.success("content://backup"))
        }

        override fun openArchive(onResult: (Result<java.io.File?>) -> Unit) {
            openArchiveCalls += 1
            onResult(
                openArchiveFailure?.let { Result.failure(it) } ?: Result.success(archiveToOpen)
            )
        }
    }

    private val replies = mutableListOf<AsyncReply>()
    private fun respond(reply: AsyncReply) {
        replies += reply
    }

    private class Recorder : StreamSink {
        val events = mutableListOf<String>()
        val payloads = mutableListOf<Pair<String, kotlinx.serialization.json.JsonElement>>()

        override fun event(name: String, payload: kotlinx.serialization.json.JsonElement) {
            events += name
            payloads += name to payload
        }

        override fun text(name: String, text: String) = Unit

        override fun bytes(name: String, bytes: ByteArray) = Unit
    }

    private fun call(handler: SafHandler, method: String, payload: JsonObject = JsonObject(emptyMap())) {
        handler.handle(method, payload, ::respond, NoopStreamSink)
    }

    private fun ok(reply: AsyncReply): JsonObject {
        assertTrue("expected Ok but was $reply", reply is AsyncReply.Ok)
        return (reply as AsyncReply.Ok).payload.jsonObject
    }

    private fun asyncCall(
        handler: SafHandler,
        method: String,
        payload: JsonObject = JsonObject(emptyMap()),
        sink: StreamSink = NoopStreamSink
    ) {
        handler.handle(method, payload, ::respond, sink)
    }

    @Test
    fun `storage info comes from the platform port`() {
        val port = FakePort(granted = false)
        val handler = SafHandler(port)

        call(handler, "storage.info")

        val payload = ok(replies.single())
        assertEquals("false", payload["hasPermission"]!!.jsonPrimitive.content)
        assertTrue(
            payload["workspace"]!!.jsonPrimitive.content.endsWith("/workspaces/default")
        )
    }

    @Test
    fun `storage permission reports the dialog result`() {
        val port = FakePort(granted = true)
        val handler = SafHandler(port)

        call(handler, "storage.requestPermission")

        assertEquals("true", ok(replies.single())["granted"]!!.jsonPrimitive.content)
    }

    @Test
    fun `saf open returns name uri content and size`() {
        val port = FakePort(
            document = SafDocument("notes.txt", "content://notes", "hello", 5)
        )
        val handler = SafHandler(port)

        call(handler, "saf.open", buildJsonObject { put("mime", "text/plain") })

        assertEquals("text/plain", port.lastMime)
        val payload = ok(replies.single())
        assertEquals("notes.txt", payload["name"]!!.jsonPrimitive.content)
        assertEquals("content://notes", payload["uri"]!!.jsonPrimitive.content)
        assertEquals("hello", payload["content"]!!.jsonPrimitive.content)
        assertEquals(5, payload["size"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `saf open cancel is a null reply not an error`() {
        val port = FakePort(document = null)
        val handler = SafHandler(port)

        call(handler, "saf.open")

        val reply = replies.single()
        assertTrue(reply is AsyncReply.Ok)
        assertEquals("null", (reply as AsyncReply.Ok).payload.toString())
    }

    @Test
    fun `saf open rejects documents over 4 MB`() {
        val size = 4 * 1024 * 1024 + 1
        val port = FakePort(
            document = SafDocument("huge.bin", "content://huge", "a", size)
        )
        val handler = SafHandler(port)

        call(handler, "saf.open")

        val reply = replies.single()
        assertTrue(reply is AsyncReply.Error)
        assertEquals(ErrorCode.E_LIMIT, (reply as AsyncReply.Error).code)
    }

    @Test
    fun `saf save writes through the port and returns the uri`() {
        val port = FakePort(savedUri = "content://created")
        val handler = SafHandler(port)

        call(
            handler,
            "saf.save",
            buildJsonObject {
                put("name", "out.txt")
                put("content", "data")
            }
        )

        assertEquals("out.txt", port.lastSaveName)
        assertEquals("data", port.lastSaveContent)
        val payload = ok(replies.single())
        assertEquals("out.txt", payload["name"]!!.jsonPrimitive.content)
        assertEquals("content://created", payload["uri"]!!.jsonPrimitive.content)
    }

    @Test
    fun `saf save cancel is a null reply`() {
        val handler = SafHandler(FakePort(savedUri = null))

        call(handler, "saf.save", buildJsonObject { put("name", "out.txt") })

        val reply = replies.single()
        assertTrue(reply is AsyncReply.Ok)
        assertEquals("null", (reply as AsyncReply.Ok).payload.toString())
    }

    @Test
    fun `saf save rejects content over 4 MB before opening a picker`() {
        val port = FakePort()
        val handler = SafHandler(port)
        val payload = buildJsonObject {
            put("name", "huge.txt")
            put("content", "a".repeat(4 * 1024 * 1024 + 1))
        }

        try {
            call(handler, "saf.save", payload)
            fail("oversized save was accepted")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_LIMIT, e.errorCode)
        }
        assertEquals(null, port.lastSaveName)
        assertTrue(replies.isEmpty())
    }

    @Test
    fun `saf open reports a failed read as E_IO`() {
        val port = FakePort().apply { openFailure = java.io.IOException("provider offline") }
        val handler = SafHandler(port)

        call(handler, "saf.open")

        val reply = replies.single()
        assertTrue(reply is AsyncReply.Error)
        assertEquals(ErrorCode.E_IO, (reply as AsyncReply.Error).code)
        assertFalse(reply.message.contains("provider offline"))
    }

    @Test
    fun `saf open maps a revoked provider to E_PERMISSION`() {
        val port = FakePort().apply { openFailure = SecurityException("denied") }
        val handler = SafHandler(port)

        call(handler, "saf.open")

        val reply = replies.single()
        assertTrue(reply is AsyncReply.Error)
        assertEquals(ErrorCode.E_PERMISSION, (reply as AsyncReply.Error).code)
    }

    @Test
    fun `saf save reports a failed write instead of a URI`() {
        val port = FakePort().apply { saveFailure = java.io.IOException("disk full") }
        val handler = SafHandler(port)

        call(handler, "saf.save", buildJsonObject { put("name", "out.txt") })

        val reply = replies.single()
        assertTrue(reply is AsyncReply.Error)
        assertEquals(ErrorCode.E_IO, (reply as AsyncReply.Error).code)
    }

    @Test
    fun `saf importTree reports progress and the copied tree`() {
        val port = FakePort()
        val handler = SafHandler(port)
        val sink = Recorder()

        asyncCall(handler, "saf.importTree", buildJsonObject { put("dest", "imports") }, sink)

        assertEquals("imports", port.importDest)
        assertEquals(listOf("saf.progress"), sink.events)
        val payload = ok(replies.single())
        assertEquals("dest", payload["path"]!!.jsonPrimitive.content)
        assertEquals(2, payload["files"]!!.jsonPrimitive.content.toInt())
        assertEquals(10L, payload["bytes"]!!.jsonPrimitive.content.toLong())
    }

    @Test
    fun `saf importTree cancel is a null reply`() {
        val port = FakePort().apply { treeResult = null }
        val handler = SafHandler(port)

        asyncCall(handler, "saf.importTree")

        assertEquals("null", (replies.single() as AsyncReply.Ok).payload.toString())
    }

    @Test
    fun `saf importTree maps a failed copy to E_IO`() {
        val port = FakePort().apply { treeFailure = java.io.IOException("disk full") }
        val handler = SafHandler(port)

        asyncCall(handler, "saf.importTree")

        val reply = replies.single()
        assertEquals(ErrorCode.E_IO, (reply as AsyncReply.Error).code)
    }

    @Test
    fun `saf exportWorkspace zips the workspace and copies it out`() {
        val workspace = createTempDir("export-workspace")
        java.io.File(workspace, "main.py").writeText("print(1)")
        java.io.File(workspace, "util.py").writeText("x = 1")
        val scratch = createTempDir("export-scratch")
        val port = FakePort()
        val handler = SafHandler(port, workspaceRoot = { workspace }, scratchRoot = { scratch })
        val sink = Recorder()

        asyncCall(handler, "saf.exportWorkspace", buildJsonObject { put("name", "backup.zip") }, sink)

        assertEquals("backup.zip", port.exportName)
        assertTrue(port.exportedZip!!.isNotEmpty())
        assertTrue(sink.events.isNotEmpty())
        assertTrue(sink.events.all { it == "saf.progress" })
        // The copy-out progress reports the archived file count, not 0 (PD-21).
        val copyOut = sink.payloads
            .filter { it.first == "saf.progress" }
            .map { it.second.jsonObject }
            .filter { it["bytes"]!!.jsonPrimitive.content.toLong() == 0L }
        assertEquals(1, copyOut.size)
        assertEquals(2, copyOut.single()["files"]!!.jsonPrimitive.content.toInt())
        val payload = ok(replies.single())
        assertEquals("backup.zip", payload["name"]!!.jsonPrimitive.content)
        assertEquals("content://backup", payload["uri"]!!.jsonPrimitive.content)
        assertEquals(2, payload["files"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `saf exportWorkspace uses a default backup name`() {
        val workspace = createTempDir("export-workspace-default")
        java.io.File(workspace, "a.txt").writeText("a")
        val port = FakePort()
        val handler = SafHandler(
            port,
            workspaceRoot = { workspace },
            scratchRoot = { createTempDir("scratch-default") }
        )

        asyncCall(handler, "saf.exportWorkspace")

        assertEquals("leocode-backup.zip", port.exportName)
    }

    @Test
    fun `saf exportWorkspace cancel is a null reply`() {
        val workspace = createTempDir("export-workspace-cancel")
        val port = FakePort()
        val cancelling = object : SafPort by port {
            override fun exportArchive(
                name: String,
                archive: java.io.File,
                onProgress: (files: Int, bytes: Long) -> Unit,
                onResult: (Result<String?>) -> Unit
            ) {
                onResult(Result.success(null))
            }
        }
        val handler = SafHandler(
            cancelling,
            workspaceRoot = { workspace },
            scratchRoot = { createTempDir("scratch-cancel") }
        )

        asyncCall(handler, "saf.exportWorkspace")

        assertEquals("null", (replies.single() as AsyncReply.Ok).payload.toString())
    }

    @Test
    fun `saf restoreArchive unpacks the selected zip`() {
        val source = createTempDir("restore-source")
        java.io.File(source, "app.py").writeText("print('restored')")
        val zip = java.io.File(createTempDir("restore-zip"), "backup.zip")
        dev.leocode.workspace.ZipBackup().export(source, zip)
        val destination = createTempDir("restore-dest")
        val scratch = java.io.File(createTempDir("restore-scratch-root"), "tmp")
        val port = FakePort().apply { archiveToOpen = zip }
        val handler = SafHandler(port, workspaceRoot = { destination }, scratchRoot = { scratch })
        val sink = Recorder()

        asyncCall(handler, "saf.restoreArchive", buildJsonObject { put("confirm", true) }, sink)

        val payload = ok(replies.single())
        assertEquals(1, payload["files"]!!.jsonPrimitive.content.toInt())
        assertEquals("print('restored')", java.io.File(destination, "app.py").readText())
        assertTrue(sink.events.all { it == "saf.progress" })
        assertFalse(
            destination.walkTopDown().any { it.isFile && it.name.endsWith(".tmp") }
        )
    }

    @Test
    fun `saf restoreArchive requires confirmation before opening a picker`() {
        val port = FakePort()
        val handler = SafHandler(port, scratchRoot = { createTempDir("restore-unconfirmed") })

        try {
            asyncCall(handler, "saf.restoreArchive", buildJsonObject { put("confirm", false) })
            fail("unconfirmed restore was accepted")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_BAD_ENVELOPE, e.errorCode)
        }
        assertEquals(0, port.openArchiveCalls)
        assertTrue(replies.isEmpty())

        asyncCall(handler, "saf.restoreArchive", buildJsonObject { put("confirm", true) })

        assertEquals(1, port.openArchiveCalls)
    }

    @Test
    fun `a heavy backup operation holds the lock until it replies`() {
        val port = FakePort()
        var pending: ((Result<SafTreeResult?>) -> Unit)? = null
        val deferring = object : SafPort by port {
            override fun importTree(
                dest: String?,
                onProgress: (files: Int, bytes: Long) -> Unit,
                onResult: (Result<SafTreeResult?>) -> Unit
            ) {
                pending = onResult
            }
        }
        val handler = SafHandler(deferring, scratchRoot = { createTempDir("lock-scratch") })
        val payload = buildJsonObject { put("dest", "imports") }

        asyncCall(handler, "saf.importTree", payload)
        assertTrue(replies.isEmpty())

        try {
            asyncCall(handler, "saf.importTree", payload)
            fail("a second backup operation was accepted")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_BUSY, e.errorCode)
        }
        assertTrue(replies.isEmpty())

        pending!!(Result.success(SafTreeResult("dest", 1, 1)))
        assertTrue(replies.single() is AsyncReply.Ok)

        asyncCall(handler, "saf.importTree", payload)
        assertEquals(1, replies.size)
        pending!!(Result.success(SafTreeResult("dest", 1, 1)))
        assertEquals(2, replies.size)
    }

    @Test
    fun `saf restoreArchive cancel is a null reply`() {
        val handler = SafHandler(FakePort())

        asyncCall(handler, "saf.restoreArchive", buildJsonObject { put("confirm", true) })

        assertEquals("null", (replies.single() as AsyncReply.Ok).payload.toString())
    }

    @Test
    fun `saf restoreArchive maps a revoked provider to E_PERMISSION`() {
        val port = FakePort().apply { openArchiveFailure = SecurityException("denied") }
        val handler = SafHandler(port)

        asyncCall(handler, "saf.restoreArchive", buildJsonObject { put("confirm", true) })

        val reply = replies.single()
        assertEquals(ErrorCode.E_PERMISSION, (reply as AsyncReply.Error).code)
    }

    @Test
    fun `methods table has the SAF, backup and storage methods`() {
        assertEquals(
            setOf(
                "saf.open",
                "saf.save",
                "saf.importTree",
                "saf.exportWorkspace",
                "saf.restoreArchive",
                "storage.info",
                "storage.requestPermission"
            ),
            SafHandler(FakePort()).methods()
        )
    }
}
