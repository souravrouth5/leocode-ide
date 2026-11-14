package dev.leocode.core

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RingBufferTest {

    private fun ascii(value: String) = value.toByteArray(Charsets.UTF_8)

    @Test
    fun `keeps everything that fits`() {
        val ring = RingBuffer(8)
        ring.write(ascii("abc"))
        ring.write(ascii("def"))
        assertEquals(6, ring.size())
        assertArrayEquals(ascii("abcdef"), ring.snapshot())
    }

    @Test
    fun `drops the oldest bytes on overflow`() {
        val ring = RingBuffer(8)
        ring.write(ascii("abcdef"))
        ring.write(ascii("ghij"))
        assertEquals(8, ring.size())
        assertArrayEquals(ascii("cdefghij"), ring.snapshot())
    }

    @Test
    fun `a write larger than the buffer keeps its tail`() {
        val ring = RingBuffer(8)
        ring.write(ascii("0123456789"))
        assertArrayEquals(ascii("23456789"), ring.snapshot())
    }

    @Test
    fun `trims a partially dropped head chunk`() {
        val ring = RingBuffer(5)
        ring.write(ascii("ab"))
        ring.write(ascii("cde"))
        // total 5, no drop
        assertArrayEquals(ascii("abcde"), ring.snapshot())
        ring.write(ascii("f"))
        // a is trimmed from the middle of the first chunk
        assertArrayEquals(ascii("bcdef"), ring.snapshot())
    }

    @Test
    fun `clear empties the buffer`() {
        val ring = RingBuffer(4)
        ring.write(ascii("data"))
        ring.clear()
        assertEquals(0, ring.size())
        assertArrayEquals(ByteArray(0), ring.snapshot())
    }

    @Test
    fun `an aligned snapshot starts on a line boundary after truncation`() {
        val ring = RingBuffer(20)
        ring.write("first-line\nsecond-line\nthird-line\n".toByteArray())

        val aligned = ring.snapshotAligned()
        val text = String(aligned, Charsets.UTF_8)

        assertTrue("missing SGR reset: $text", text.startsWith("\u001b[0m"))
        assertTrue(text.endsWith("third-line\n"))
        assertFalse("replay began mid-line: $text", text.removePrefix("\u001b[0m").startsWith("ine"))
    }

    @Test
    fun `an untrimmed snapshot is unchanged`() {
        val ring = RingBuffer(100)
        ring.write("hello".toByteArray())

        assertArrayEquals("hello".toByteArray(), ring.snapshotAligned())
    }
}
