package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseManifestTest {

    private val valid = """
        {
          "schema": 1,
          "package": "dev.leocode",
          "versionName": "0.1.0-rc2",
          "versionCode": 1002,
          "minSdk": 28,
          "notes": "Signed self-update demo",
          "apk": {
            "url": "https://github.com/souravrouth5/leocode-ide/releases/download/v0.1.0-rc2/leocode.apk",
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "size": 12345678
          }
        }
    """.trimIndent()

    @Test
    fun `parses a signed release manifest`() {
        val manifest = ReleaseManifest.parse(valid)

        assertEquals("dev.leocode", manifest.packageName)
        assertEquals("0.1.0-rc2", manifest.versionName)
        assertEquals(1002, manifest.versionCode)
        assertEquals(28, manifest.minSdk)
        assertEquals("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", manifest.apkSha256)
        assertEquals(12_345_678L, manifest.apkSize)
    }

    @Test
    fun `normalises an upper-case hash`() {
        val upper = valid.replace(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF"
        )

        assertEquals(
            "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ReleaseManifest.parse(upper).apkSha256
        )
    }

    @Test
    fun `rejects malformed json and an unknown schema`() {
        assertBadManifest("{")
        assertBadManifest(valid.replace("\"schema\": 1", "\"schema\": 2"))
    }

    @Test
    fun `rejects missing or invalid fields`() {
        assertBadManifest(valid.replace("\"versionCode\": 1002,", ""))
        assertBadManifest(valid.replace("\"versionCode\": 1002", "\"versionCode\": 0"))
        assertBadManifest(valid.replace("\"minSdk\": 28", "\"minSdk\": 0"))
        assertBadManifest(valid.replace("\"versionName\": \"0.1.0-rc2\"", "\"versionName\": \" \""))
        assertBadManifest(valid.replace("\"size\": 12345678", "\"size\": 0"))
    }

    @Test
    fun `rejects a hash that is not SHA-256 and an unsupported URL`() {
        assertBadManifest(valid.replace("\"sha256\": \"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"", "\"sha256\": \"abc\""))
        assertBadManifest(valid.replace("\"url\": \"https://", "\"url\": \"ftp://"))
    }

    @Test
    fun `accepts a local file URL for the device demo`() {
        val local = valid.replace(
            "\"url\": \"https://github.com/souravrouth5/leocode-ide/releases/download/v0.1.0-rc2/leocode.apk\"",
            "\"url\": \"file:///sdcard/Download/leocode-update/leocode-102.apk\""
        )

        assertEquals(
            "file:///sdcard/Download/leocode-update/leocode-102.apk",
            ReleaseManifest.parse(local).apkUrl
        )
    }

    @Test
    fun `truncates very long release notes`() {
        val long = valid.replace(
            "\"notes\": \"Signed self-update demo\"",
            "\"notes\": \"${"x".repeat(ReleaseManifest.MAX_NOTES + 50)}\""
        )

        assertEquals(ReleaseManifest.MAX_NOTES, ReleaseManifest.parse(long).notes.length)
    }

    @Test
    fun `the committed release key is a valid Ed25519 key`() {
        assertEquals(32, ReleaseKeys.RELEASE.size)
        assertTrue(ReleaseKeys.FINGERPRINT.matches(Regex("^[a-f0-9]{64}$")))
    }

    @Test
    fun `the committed release key fingerprint matches its SPKI`() {
        // Ed25519 SubjectPublicKeyInfo prefix followed by the raw 32-byte key.
        val prefix = byteArrayOf(
            0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00
        )
        val digest = java.security.MessageDigest.getInstance("SHA-256")
            .digest(prefix + ReleaseKeys.RELEASE)
            .joinToString("") { "%02x".format(it) }
        assertEquals(ReleaseKeys.FINGERPRINT, digest)
    }

    private fun assertBadManifest(text: String) {
        val error = runCatching { ReleaseManifest.parse(text) }.exceptionOrNull()
        assertTrue("expected UpdateException for: $text", error is UpdateException)
        assertEquals("E_BAD_MANIFEST", (error as UpdateException).code)
    }
}
