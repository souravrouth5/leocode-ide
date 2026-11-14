package dev.leocode.bridge

import dev.leocode.workspace.Drafts
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DraftHandlerTest {

    private val drafts = Drafts(createTempDir("draft-handler"), { "default" })
    private val handler = DraftHandler(drafts)

    private fun call(method: String, payload: JsonObject = JsonObject(emptyMap())) =
        handler.handle(method, payload)

    private fun expect(code: ErrorCode, block: () -> Unit) {
        try {
            block()
            fail("expected $code")
        } catch (e: BridgeException) {
            assertEquals(code, e.errorCode)
        }
    }

    @Test
    fun `save list read and delete through the bridge`() {
        val saved = call(
            "draft.save",
            buildJsonObject {
                put("path", "src/app.py")
                put("content", "print(1)")
                put("eol", "\r\n")
            }
        ).jsonObject
        assertEquals("true", saved["ok"]!!.jsonPrimitive.content)

        val list = call("draft.list") as JsonArray
        assertEquals(1, list.size)
        assertEquals("src/app.py", list.single().jsonObject["path"]!!.jsonPrimitive.content)
        assertEquals(8, list.single().jsonObject["size"]!!.jsonPrimitive.content.toInt())

        val read = call("draft.read", buildJsonObject { put("path", "src/app.py") }).jsonObject
        assertEquals("print(1)", read["content"]!!.jsonPrimitive.content)
        assertEquals("\r\n", read["eol"]!!.jsonPrimitive.content)
        assertTrue(read["mtime"]!!.jsonPrimitive.content.toLong() > 0L)

        val deleted = call("draft.delete", buildJsonObject { put("path", "src/app.py") }).jsonObject
        assertEquals("true", deleted["ok"]!!.jsonPrimitive.content)
        expect(ErrorCode.E_NOT_FOUND) {
            call("draft.read", buildJsonObject { put("path", "src/app.py") })
        }
    }

    @Test
    fun `missing paths are bad envelopes`() {
        expect(ErrorCode.E_BAD_ENVELOPE) { call("draft.read") }
        expect(ErrorCode.E_BAD_ENVELOPE) {
            call("draft.save", buildJsonObject { put("content", "x") })
        }
        expect(ErrorCode.E_BAD_ENVELOPE) { call("draft.delete") }
    }

    @Test
    fun `the method table matches the contract`() {
        assertEquals(
            setOf("draft.list", "draft.read", "draft.save", "draft.delete"),
            handler.methods()
        )
    }
}
