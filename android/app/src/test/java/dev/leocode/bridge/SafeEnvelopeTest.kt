package dev.leocode.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeEnvelopeTest {

    private fun obj(text: String): JsonObject = Json.parseToJsonElement(text) as JsonObject

    @Test
    fun `string and numeric ids are accepted and returned as strings`() {
        assertEquals("7", SafeEnvelope.id(obj("""{"id":"7"}""")))
        assertEquals("7", SafeEnvelope.id(obj("""{"id":7}""")))
        assertTrue(SafeEnvelope.isValidId(SafeEnvelope.idElement(obj("""{"id":7}"""))))
    }

    @Test
    fun `absent and null ids are valid and empty`() {
        assertNull(SafeEnvelope.id(obj("{}")))
        assertNull(SafeEnvelope.id(obj("""{"id":null}""")))
        assertTrue(SafeEnvelope.isValidId(SafeEnvelope.idElement(obj("{}"))))
    }

    @Test
    fun `object and array ids are rejected without throwing`() {
        val objectId = SafeEnvelope.idElement(obj("""{"id":{}}"""))
        val arrayId = SafeEnvelope.idElement(obj("""{"id":[]}"""))
        assertFalse(SafeEnvelope.isValidId(objectId))
        assertFalse(SafeEnvelope.isValidId(arrayId))
        assertNull(SafeEnvelope.id(obj("""{"id":{}}""")))
        assertNull(SafeEnvelope.id(obj("""{"id":[]}""")))
    }

    @Test
    fun `a numeric id still behaves like a primitive`() {
        val element = SafeEnvelope.idElement(obj("""{"id":12}"""))
        assertTrue(element is JsonPrimitive)
    }
}
