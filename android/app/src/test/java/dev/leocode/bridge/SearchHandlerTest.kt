package dev.leocode.bridge

import dev.leocode.workspace.SearchEngine
import java.io.File
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class SearchHandlerTest {

    private val root = createTempDir("search-handler")
    private val handler = SearchHandler(SearchEngine(), { root })

    private class Recorder : StreamSink {
        val events = mutableListOf<Pair<String, JsonElement>>()

        override fun event(name: String, payload: JsonElement) {
            events += name to payload
        }

        override fun text(name: String, text: String) = Unit

        override fun bytes(name: String, bytes: ByteArray) = Unit
    }

    private fun file(path: String, content: String) {
        File(root, path).also { it.parentFile?.mkdirs(); it.writeText(content) }
    }

    private fun expect(code: ErrorCode, block: () -> Unit) {
        try {
            block()
            fail("expected $code")
        } catch (e: BridgeException) {
            assertEquals(code, e.errorCode)
        }
    }

    @Test
    fun `matches stream as search match events and the reply counts them`() {
        file("a.txt", "needle one\nneedle two\n")
        file("b.txt", "nothing")
        val sink = Recorder()

        val reply = handler.handle(
            "fs.search",
            buildJsonObject {
                put("query", "needle")
                put("searchId", "search-1")
            },
            sink
        ).jsonObject

        assertEquals("2", reply["count"]!!.jsonPrimitive.content)
        assertEquals("false", reply["truncated"]!!.jsonPrimitive.content)
        assertEquals(2, sink.events.size)
        assertTrue(sink.events.all { it.first == "search.match" })
        val first = sink.events.first().second.jsonObject
        assertEquals("a.txt", first["path"]!!.jsonPrimitive.content)
        assertEquals("1", first["line"]!!.jsonPrimitive.content)
        assertEquals("needle one", first["preview"]!!.jsonPrimitive.content)
    }

    @Test
    fun `glob and case sensitivity are passed through`() {
        file("src/a.py", "Needle")
        file("src/b.txt", "Needle")

        val reply = handler.handle(
            "fs.search",
            buildJsonObject {
                put("query", "needle")
                put("glob", "*.py")
                put("caseSensitive", true)
            },
            Recorder()
        ).jsonObject

        assertEquals("0", reply["count"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a missing query is a bad envelope`() {
        expect(ErrorCode.E_BAD_ENVELOPE) {
            handler.handle("fs.search", buildJsonObject { put("query", "") }, Recorder())
        }
    }

    @Test
    fun `cancelling an unknown search reports false`() {
        val reply = handler.handle(
            "fs.search.cancel",
            buildJsonObject { put("searchId", "missing") }
        ).jsonObject

        assertEquals("false", reply["cancelled"]!!.jsonPrimitive.content)
    }

    @Test
    fun `cancel requires a search id`() {
        expect(ErrorCode.E_BAD_ENVELOPE) {
            handler.handle("fs.search.cancel", buildJsonObject { })
        }
    }

    @Test
    fun `the method table matches the contract`() {
        assertEquals(setOf("fs.search", "fs.search.cancel"), handler.methods())
    }
}
