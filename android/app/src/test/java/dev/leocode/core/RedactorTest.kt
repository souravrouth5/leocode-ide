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

    // ------------------------------------------------------------- L-14 shapes

    @Test
    fun `redacts underscore-joined environment variables`() {
        val out = Redactor.redact(
            "GITHUB_TOKEN=ghp_1234567890abcdefghij\n" +
                "DB_PASSWORD=correct-horse-battery\n" +
                "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCY"
        )
        assertFalse(out.contains("correct-horse-battery"))
        assertFalse(out.contains("wJalrXUtnFEMIK7MDENGbPxRfiCY"))
        assertTrue(out.contains("GITHUB_TOKEN=<redacted>"))
        assertTrue(out.contains("DB_PASSWORD=<redacted>"))
        assertTrue(out.contains("AWS_SECRET_ACCESS_KEY=<redacted>"))
    }

    @Test
    fun `redacts quoted json keys`() {
        val out = Redactor.redact(
            """{"user":"sourav","token":"abc123","apiKey": "sk-live-9f8e7d"}"""
        )
        assertFalse(out.contains("abc123"))
        assertTrue(out.contains("\"token\":\"<redacted>\""))
        assertTrue(out.contains("\"apiKey\": \"<redacted>\""))
        // Ordinary fields stay readable.
        assertTrue(out.contains("\"user\":\"sourav\""))
    }

    @Test
    fun `redacts single-quoted json style values`() {
        val out = Redactor.redact("{'password':'s3cr3t','name':'leo'}")
        assertFalse(out.contains("s3cr3t"))
        assertTrue(out.contains("'password':'<redacted>'"))
        assertTrue(out.contains("'name':'leo'"))
    }

    @Test
    fun `redacts url user-info passwords and keeps the user name`() {
        val out = Redactor.redact("clone https://sourav:hunter2@github.com/x/y.git failed")
        assertFalse(out.contains("hunter2"))
        assertTrue(out.contains("https://sourav:<redacted>@github.com"))
    }

    @Test
    fun `keeps a url without credentials`() {
        val input = "GET https://example.test/path?ok=1"
        assertEquals(input, Redactor.redact(input))
    }

    @Test
    fun `redacts known token prefixes`() {
        val tokens = listOf(
            "ghp_1234567890abcdefghijklmnopqrstuvwx",
            "gho_1234567890abcdefghijklmnopqrstuvwx",
            "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH",
            "sk-proj-abcdefghijklmnopqrstuvwxyz",
            "AKIAIOSFODNN7EXAMPLE",
            "xoxb-123456789012-123456789012-abcdefghijklmnop",
            "xoxp-123456789012-abcdefghij"
        )
        for (token in tokens) {
            val out = Redactor.redact("credential $token leaked")
            assertFalse("not redacted: $token -> $out", out.contains(token))
            assertTrue(out.contains("<redacted>"))
        }
    }

    @Test
    fun `redacts a pem private key block`() {
        val pem = """
            -----BEGIN RSA PRIVATE KEY-----
            MIIEowIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz
            ABCDEFGHIJKLMNOPQRSTUVWXYZ0987654321
            -----END RSA PRIVATE KEY-----
        """.trimIndent()
        val out = Redactor.redact("key:\n$pem\ndone")
        assertFalse(out.contains("MIIEowIBAAKCAQEA"))
        assertFalse(out.contains("BEGIN RSA PRIVATE KEY"))
        assertTrue(out.contains("<redacted-private-key>"))
        assertTrue(out.endsWith("done"))
    }

    @Test
    fun `redacts a truncated pem block`() {
        val out = Redactor.redact(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n(the log ends here)"
        )
        assertFalse(out.contains("b3BlbnNzaC1rZXktdjEAAAAA"))
        assertTrue(out.contains("<redacted-private-key>"))
    }

    @Test
    fun `keeps a name that has no separator after it`() {
        val out = Redactor.redact("Error: GITHUB_TOKEN is unset, falling back to anonymous")
        // No separator and no token prefix: nothing to mask.
        assertEquals("Error: GITHUB_TOKEN is unset, falling back to anonymous", out)
    }

    // ------------------------------------------------------------------ legacy

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

    @Test
    fun `is idempotent for every shape`() {
        val text = """
            GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwx
            {"token":"abc123"}
            https://sourav:hunter2@github.com/x/y.git
            AKIAIOSFODNN7EXAMPLE
            -----BEGIN EC PRIVATE KEY-----
            MHcCAQEEIBkg
            -----END EC PRIVATE KEY-----
            at /data/user/0/dev.leocode/files/x.kt:1
        """.trimIndent()
        val once = Redactor.redact(text)
        assertEquals(once, Redactor.redact(once))
    }
}
