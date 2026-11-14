package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RedactorTest {

    @Test
    fun `redacts workspace and storage paths`() {
        val input = "at dev.leocode.MainActivity(MainActivity.kt:42) /data/user/0/dev.leocode/files/ws/a.py"
        val out = Redactor.redact(input)
        assertFalse(out.contains("/data/user/0/dev.leocode"))
        assertTrue(out.contains("<path>"))
        assertTrue(out.contains("MainActivity.kt:42"))
    }

    @Test
    fun `redacts a shared-storage path inside a message`() {
        val out = Redactor.redact("open failed: /storage/emulated/0/Download/secret.txt")
        assertEquals("open failed: <path>", out)
    }

    @Test
    fun `redacts assignment-style secrets`() {
        val out = Redactor.redact("password=hunter2 token: abc123 api_key = k-9")
        assertFalse(out.contains("hunter2"))
        assertFalse(out.contains("abc123"))
        assertFalse(out.contains("k-9"))
        assertTrue(out.contains("password=<redacted>"))
        assertTrue(out.contains("token: <redacted>"))
    }

    @Test
    fun `redacts bearer tokens and query credentials`() {
        val out = Redactor.redact(
            "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig\n" +
                "GET https://example.test/x?token=deadbeef&ok=1"
        )
        assertFalse(out.contains("eyJhbGciOiJIUzI1NiJ9"))
        assertFalse(out.contains("deadbeef"))
        assertTrue(out.contains("Bearer <redacted>"))
        assertTrue(out.contains("token=<redacted>"))
    }

    @Test
    fun `keeps ordinary text and class names`() {
        val input = "java.lang.IllegalStateException: WebView is too old\n\tat dev.leocode.MainActivity.onCreate"
        assertEquals(input, Redactor.redact(input))
    }

    @Test
    fun `is idempotent`() {
        val once = Redactor.redact("token=abc at /data/data/dev.leocode/x")
        assertEquals(once, Redactor.redact(once))
    }
}
