package dev.leocode.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
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

class BridgeRouterTest {

    private val json = Json { ignoreUnknownKeys = true }

    private class FakeHandler(
        private val names: Set<String>,
        private val body: (String, JsonObject) -> JsonElement
    ) : BridgeHandler {
        override fun methods(): Set<String> = names
        override fun handle(method: String, payload: JsonObject): JsonElement = body(method, payload)
    }

    private fun router(vararg handlers: BridgeHandler, log: (String) -> Unit = {}): BridgeRouter =
        BridgeRouter(json, handlers.toList(), log)

    private fun request(
        method: String?,
        v: Int = 1,
        payload: JsonObject = JsonObject(emptyMap()),
        id: String = "42"
    ): JsonObject = buildJsonObject {
        put("v", v)
        put("id", id)
        if (method != null) put("method", method)
        put("payload", payload)
    }

    private fun noTheme(): ThemePort = object : ThemePort {
        override fun state(): JsonObject = JsonObject(emptyMap())
        override fun setMode(mode: String?): JsonObject = state()
    }

    private fun errorCode(reply: JsonObject): String =
        reply["error"]!!.jsonObject["code"]!!.jsonPrimitive.content

    private fun errorMessage(reply: JsonObject): String =
        reply["error"]!!.jsonObject["message"]!!.jsonPrimitive.content

    private fun isOk(reply: JsonObject): Boolean = reply["ok"]!!.jsonPrimitive.content == "true"

    @Test
    fun `dispatches app ping and echoes the request id`() {
        val router = router(
            AppHandler(noTheme(), { buildJsonObject { put("app", "LeoCode") } }, json)
        )

        val reply = router.dispatch(request("app.ping"))

        assertEquals(1, reply["v"]!!.jsonPrimitive.content.toInt())
        assertEquals("42", reply["id"]!!.jsonPrimitive.content)
        assertTrue(isOk(reply))
        assertEquals(
            "true",
            reply["payload"]!!.jsonObject["pong"]!!.jsonPrimitive.content
        )
    }

    @Test
    fun `unknown method returns E_UNKNOWN_METHOD`() {
        val router = router(
            FakeHandler(setOf("known.method")) { _, _ -> JsonObject(emptyMap()) }
        )

        val reply = router.dispatch(request("other.method"))

        assertFalse(isOk(reply))
        assertEquals("E_UNKNOWN_METHOD", errorCode(reply))
    }

    @Test
    fun `protocol version other than 1 returns E_UNSUPPORTED`() {
        val router = router(
            FakeHandler(setOf("known.method")) { _, _ -> JsonObject(emptyMap()) }
        )

        val reply = router.dispatch(request("known.method", v = 2))

        assertFalse(isOk(reply))
        assertEquals("E_UNSUPPORTED", errorCode(reply))
    }

    @Test
    fun `missing method returns E_BAD_ENVELOPE`() {
        val router = router(
            FakeHandler(setOf("known.method")) { _, _ -> JsonObject(emptyMap()) }
        )

        val reply = router.dispatch(request(null))

        assertFalse(isOk(reply))
        assertEquals("E_BAD_ENVELOPE", errorCode(reply))
    }

    @Test
    fun `bridge exception keeps its typed code and message`() {
        val router = router(
            FakeHandler(setOf("x.fail")) { _, _ ->
                throw BridgeException(ErrorCode.E_NOT_FOUND, "no such file")
            }
        )

        val reply = router.dispatch(request("x.fail"))

        assertFalse(isOk(reply))
        assertEquals("E_NOT_FOUND", errorCode(reply))
        assertEquals("no such file", errorMessage(reply))
    }

    @Test
    fun `unexpected failure is redacted and correlated`() {
        val logs = mutableListOf<String>()
        val router = router(
            FakeHandler(setOf("x.boom")) { _, _ ->
                throw IllegalStateException("secret detail /data/data/dev.leocode")
            },
            log = { logs += it }
        )

        val reply = router.dispatch(request("x.boom"))

        assertFalse(isOk(reply))
        assertEquals("E_INTERNAL", errorCode(reply))
        assertEquals("Something went wrong", errorMessage(reply))
        assertFalse(errorMessage(reply).contains("secret"))

        val correlationId = reply["error"]!!.jsonObject["correlationId"]!!.jsonPrimitive.content
        assertTrue(correlationId.matches(Regex("c-[0-9a-f]{6}")))

        val logged = logs.single()
        assertTrue(logged.contains(correlationId))
        assertTrue(logged.contains("secret detail"))
    }

    @Test
    fun `malformed payload returns E_BAD_ENVELOPE`() {
        val router = router(
            AppHandler(noTheme(), { JsonObject(emptyMap()) }, json)
        )
        val payload = buildJsonObject {
            put("mode", buildJsonObject { put("nested", true) })
        }

        val reply = router.dispatch(request("app.theme.set", payload = payload))

        assertFalse(isOk(reply))
        assertEquals("E_BAD_ENVELOPE", errorCode(reply))
    }

    @Test
    fun `dispatch never throws even for an error in the handler`() {
        val router = router(
            FakeHandler(setOf("x.boom")) { _, _ -> throw AssertionError("boom") }
        )

        val reply = router.dispatch(request("x.boom"))

        assertEquals("E_INTERNAL", errorCode(reply))
    }

    @Test
    fun `registering the same method twice is rejected`() {
        try {
            router(
                FakeHandler(setOf("dup.method")) { _, _ -> JsonObject(emptyMap()) },
                FakeHandler(setOf("dup.method")) { _, _ -> JsonObject(emptyMap()) }
            )
            fail("duplicate method was accepted")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }
}
