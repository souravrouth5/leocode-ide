package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * L-20: a huge message or stack must not reach the crash file, the Intent extra
 * or the Share sheet. The record is capped at write/share time, so a record read
 * back from disk is bounded too.
 */
class CrashStoreTest {

    private fun record(
        message: String = "boom",
        stack: String = "java.lang.IllegalStateException: boom\n\tat dev.leocode.MainActivity.onCreate(MainActivity.kt:1)"
    ) = CrashRecord(
        timestamp = 1_700_000_000_000L,
        thread = "main",
        exception = "java.lang.IllegalStateException",
        message = message,
        stack = stack,
        appVersion = "0.1.0",
        sdk = 34,
        release = "14",
        model = "Pixel",
        manufacturer = "Google"
    )

    @Test
    fun `a normal record round-trips unchanged`() {
        val original = record()
        val decoded = CrashStore.decode(CrashStore.encode(original))
        assertNotNull(decoded)
        assertEquals(original, decoded)
    }

    @Test
    fun `an oversized message is capped on encode`() {
        val huge = "x".repeat(512 * 1024)
        val decoded = CrashStore.decode(CrashStore.encode(record(message = huge)))!!
        assertTrue(decoded.message.length < huge.length)
        assertTrue(decoded.message.length <= CrashStore.MAX_MESSAGE_CHARS)
        assertTrue(decoded.message.endsWith("(message truncated)"))
    }

    @Test
    fun `an oversized stack is capped on encode`() {
        val huge = (1..5_000).joinToString("\n") { "\tat dev.leocode.Frame$it.invoke(Frame.kt:$it)" }
        val decoded = CrashStore.decode(CrashStore.encode(record(stack = huge)))!!
        assertTrue(decoded.stack.length < huge.length)
        assertTrue(decoded.stack.length <= CrashStore.MAX_STACK_CHARS)
        assertEquals(CrashStore.MAX_STACK_LINES, decoded.stack.lines().size - 1)
        assertTrue(decoded.stack.endsWith("(stack truncated)"))
    }

    @Test
    fun `a few very long stack lines are capped by size`() {
        val lines = (1..3).joinToString("\n") { "y".repeat(64 * 1024) }
        val capped = CrashStore.capped(record(stack = lines)).stack
        assertTrue(capped.length <= CrashStore.MAX_STACK_CHARS)
        assertTrue(capped.endsWith("(stack truncated)"))
    }

    @Test
    fun `the encoded record stays small enough for a binder extra`() {
        val bytes = CrashStore.encode(
            record(
                message = "m".repeat(1024 * 1024),
                stack = (1..20_000).joinToString("\n") { "line $it" }
            )
        ).toByteArray(Charsets.UTF_8)
        // The Intent extra and the share sheet both carry this string; it must be
        // far below the 1 MB Binder limit even with JSON escaping.
        assertTrue("encoded ${bytes.size} bytes", bytes.size < 64 * 1024)
    }

    @Test
    fun `the share text is capped as well`() {
        val text = CrashStore.shareText(
            record(
                message = "m".repeat(512 * 1024),
                stack = (1..20_000).joinToString("\n") { "\tat dev.leocode.Frame$it.invoke(Frame.kt:$it)" }
            )
        )
        assertTrue(text.length < 512 * 1024)
        assertTrue(text.contains("(message truncated)"))
        assertTrue(text.contains("(stack truncated)"))
    }

    @Test
    fun `a surrogate pair is never split`() {
        val note = "\n… (message truncated)"
        // Both variants cut in the middle of a non-BMP character unless the cap
        // backs off one char: a naive take() would leave a broken pair behind.
        for (prefix in listOf("", "a")) {
            val message = prefix + "\uD83D\uDE00".repeat(CrashStore.MAX_MESSAGE_CHARS)
            val capped = CrashStore.capped(record(message = message)).message
            assertTrue(capped.length <= CrashStore.MAX_MESSAGE_CHARS)
            assertTrue(capped.endsWith(note))
            val body = capped.removeSuffix(note)
            assertFalse("unpaired surrogate for prefix '$prefix'", hasUnpairedSurrogate(body))
        }
    }

    @Test
    fun `a corrupt file decodes to null`() {
        assertEquals(null, CrashStore.decode("not json"))
        assertEquals(null, CrashStore.decode(""))
        assertEquals(null, CrashStore.decode(null))
    }

    private fun hasUnpairedSurrogate(text: String): Boolean {
        var i = 0
        while (i < text.length) {
            val c = text[i]
            if (Character.isHighSurrogate(c)) {
                if (i + 1 >= text.length || !Character.isLowSurrogate(text[i + 1])) return true
                i += 2
            } else if (Character.isLowSurrogate(c)) {
                return true
            } else {
                i++
            }
        }
        return false
    }
}
