package dev.leocode.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Base64
import java.util.Collections

class EventSinkTest {

    private class Recorder {
        val events: MutableList<Pair<String, JsonElement>> =
            Collections.synchronizedList(mutableListOf())

        fun sink(maxPendingBytes: Int = 256 * 1024): EventSink =
            EventSink({ event, payload -> events += event to payload }, maxPendingBytes = maxPendingBytes)
    }

    private fun data(payload: JsonElement): String =
        payload.jsonObject["data"]!!.jsonPrimitive.content

    private fun bytes(payload: JsonElement): ByteArray =
        Base64.getDecoder().decode(payload.jsonObject["b64"]!!.jsonPrimitive.content)

    @Test
    fun `three text calls flush as one concatenated event`() {
        val recorder = Recorder()
        val sink = recorder.sink()

        sink.text("proc.stdout", "a")
        sink.text("proc.stdout", "b")
        sink.text("proc.stdout", "c")
        sink.flush()

        assertEquals(1, recorder.events.size)
        assertEquals("proc.stdout", recorder.events[0].first)
        assertEquals("abc", data(recorder.events[0].second))
    }

    @Test
    fun `bytes concatenate before base64 encoding`() {
        val recorder = Recorder()
        val sink = recorder.sink()

        sink.bytes("term.data", byteArrayOf(1, 2))
        sink.bytes("term.data", byteArrayOf(3, 4))
        sink.flush()

        assertEquals(1, recorder.events.size)
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), bytes(recorder.events[0].second))
    }

    @Test
    fun `event order follows first append order`() {
        val recorder = Recorder()
        val sink = recorder.sink()

        sink.text("proc.stdout", "out")
        sink.text("proc.stderr", "err")
        sink.text("proc.stdout", "!")
        sink.flush()

        assertEquals(listOf("proc.stdout", "proc.stderr"), recorder.events.map { it.first })
        assertEquals("out!", data(recorder.events[0].second))
        assertEquals("err", data(recorder.events[1].second))
    }

    @Test
    fun `full buffer drops new data and counts it`() {
        val recorder = Recorder()
        val sink = recorder.sink(maxPendingBytes = 10)

        sink.bytes("term.data", ByteArray(8))
        sink.bytes("term.data", ByteArray(8))
        sink.flush()

        assertEquals(1, recorder.events.size)
        assertEquals(8, bytes(recorder.events[0].second).size)
        assertEquals(8L, sink.droppedBytes)
    }

    @Test
    fun `close flushes pending output`() {
        val recorder = Recorder()
        val sink = recorder.sink()

        sink.text("proc.stdout", "last")
        sink.close()

        assertEquals(1, recorder.events.size)
        assertEquals("last", data(recorder.events[0].second))
        assertTrue(recorder.events[0].first == "proc.stdout")
    }
}
