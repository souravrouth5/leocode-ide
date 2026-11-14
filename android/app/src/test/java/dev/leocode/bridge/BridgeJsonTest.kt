package dev.leocode.bridge

import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeJsonTest {

    @Test
    fun `default values stay on the wire`() {
        val ok = BridgeJson.value.encodeToJsonElement(TermOk.serializer(), TermOk()).jsonObject
        assertEquals("true", ok["ok"]!!.jsonPrimitive.content)

        val info = BridgeJson.value.encodeToJsonElement(
            TermInfo.serializer(),
            TermInfo(sessionId = "s", alive = true, title = "t", pid = 1, cwd = ".")
        ).jsonObject
        assertEquals("false", info["root"]!!.jsonPrimitive.content)
    }

    @Test
    fun `unknown keys are still ignored`() {
        val decoded = BridgeJson.value.decodeFromString(
            TermOk.serializer(),
            """{"ok":true,"future":1}"""
        )
        assertTrue(decoded.ok)
    }
}
