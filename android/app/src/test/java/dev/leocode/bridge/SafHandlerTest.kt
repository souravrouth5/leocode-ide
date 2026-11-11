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

        override fun openDocument(mime: String, onResult: (SafDocument?) -> Unit) {
            lastMime = mime
            onResult(document)
        }

        override fun saveDocument(name: String, content: String, onResult: (String?) -> Unit) {
            lastSaveName = name
            lastSaveContent = content
            onResult(savedUri)
        }
    }

    private val replies = mutableListOf<AsyncReply>()
    private fun respond(reply: AsyncReply) {
        replies += reply
    }

    private fun call(handler: SafHandler, method: String, payload: JsonObject = JsonObject(emptyMap())) {
        handler.handle(method, payload, ::respond, NoopStreamSink)
    }

    private fun ok(reply: AsyncReply): JsonObject {
        assertTrue("expected Ok but was $reply", reply is AsyncReply.Ok)
        return (reply as AsyncReply.Ok).payload.jsonObject
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
    fun `methods table has the four SAF and storage methods`() {
        assertEquals(
            setOf("saf.open", "saf.save", "storage.info", "storage.requestPermission"),
            SafHandler(FakePort()).methods()
        )
    }
}
