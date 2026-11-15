package dev.leocode.core.secrets

import java.io.File
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Task 20: the file store keeps only ciphertext and survives unreadable blobs.
 *
 * The production cipher needs the Android Keystore, so these tests use a fake
 * AES-GCM cipher. That still proves the on-disk contract: what is written is the
 * sealed blob under a hex file name, never the secret.
 */
class FileSecretStoreTest {

    @Test
    fun `round trips a secret through the store`() {
        val store = store()
        val secret = "ghp_example_token".toByteArray()

        store.put("token:github.com", secret)

        assertArrayEquals(secret, store.get("token:github.com"))
        assertTrue(store.has("token:github.com"))
        assertEquals(listOf("token:github.com"), store.ids())
    }

    @Test
    fun `the file on disk contains ciphertext only`() {
        val store = store()
        val secret = "BEGIN OPENSSH PRIVATE KEY".toByteArray()

        store.put("ssh-key:one", secret)

        val files = store.files()
        assertEquals(1, files.size)
        val bytes = files.single().readBytes()
        val asText = String(bytes, Charsets.ISO_8859_1)
        assertFalse("plaintext must not reach the disk", asText.contains("OPENSSH"))
        assertFalse(asText.contains("PRIVATE KEY"))
        // The fake marks its output so a test can tell sealed bytes from input.
        assertEquals("FAKE", String(bytes.copyOfRange(0, 4), Charsets.US_ASCII))
    }

    @Test
    fun `overwrite replaces the previous value`() {
        val store = store()
        store.put("token:example.com", "one".toByteArray())
        store.put("token:example.com", "two".toByteArray())

        assertEquals("two", String(store.get("token:example.com")!!))
        assertEquals(1, store.files().size)
    }

    @Test
    fun `delete removes the value and the file`() {
        val store = store()
        store.put("token:example.com", "secret".toByteArray())

        assertTrue(store.delete("token:example.com"))
        assertFalse(store.has("token:example.com"))
        assertNull(store.get("token:example.com"))
        assertFalse(store.delete("token:example.com"))
    }

    @Test
    fun `unknown id reads as null`() {
        assertNull(store().get("token:missing"))
    }

    @Test
    fun `a corrupt blob reads as null`() {
        val store = store()
        store.put("token:broken", "secret".toByteArray())
        store.files().single().writeBytes(byteArrayOf(1, 2, 3))

        assertNull(store.get("token:broken"))
        // It still appears in ids(): the file exists but is unusable.
        assertEquals(listOf("token:broken"), store.ids())
    }

    @Test
    fun `an unavailable key propagates instead of reading as missing`() {
        val store = FileSecretStore(File(root, "secrets"), UnavailableCipher())
        store.put("token:x", "secret".toByteArray())

        try {
            store.get("token:x")
            throw AssertionError("expected SecretUnavailableException")
        } catch (_: SecretUnavailableException) {
            // expected: the UI must tell the user to re-enter the token
        }
    }

    @Test
    fun `ids are sorted and skip unrelated files`() {
        val store = store()
        store.put("token:b", "b".toByteArray())
        store.put("token:a", "a".toByteArray())
        File(root, "secrets/not-a-secret.txt").writeText("keep me")

        assertEquals(listOf("token:a", "token:b"), store.ids())
    }

    @Test
    fun `deleteWhere removes only matching ids`() {
        val store = store()
        store.put("token:github.com", "a".toByteArray())
        store.put("ssh-key:1", "b".toByteArray())

        assertEquals(1, store.deleteWhere("token:"))

        assertEquals(listOf("ssh-key:1"), store.ids())
    }

    @Test
    fun `an id with control characters cannot escape the directory`() {
        val store = store()
        val id = "../../escape"
        store.put(id, "secret".toByteArray())

        // Hex naming means the id is inert on disk and resolves under the root.
        assertEquals(listOf(id), store.ids())
        assertEquals(1, store.files().size)
        assertTrue(store.files().single().parentFile == File(root, "secrets"))
    }

    private val root: File by lazy {
        java.nio.file.Files.createTempDirectory("secret-store").toFile()
            .also { it.deleteOnExit() }
    }

    private fun store(): FileSecretStore =
        FileSecretStore(File(root, "secrets"), FakeCipher())

    private class FakeCipher : SecretCipher {
        override fun seal(plaintext: ByteArray): ByteArray {
            val key = key()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val encrypted = cipher.doFinal(plaintext)
            return "FAKE".toByteArray() + cipher.iv + encrypted
        }

        override fun open(blob: ByteArray): ByteArray {
            require(blob.size > 16 && String(blob.copyOfRange(0, 4), Charsets.US_ASCII) == "FAKE")
            val key = key()
            val iv = blob.copyOfRange(4, 16)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
            return cipher.doFinal(blob, 16, blob.size - 16)
        }

        // One key per fake instance would be wrong across put/get, so use a static.
        private fun key(): SecretKey = sharedKey

        companion object {
            private val sharedKey: SecretKey =
                KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        }
    }

    private class UnavailableCipher : SecretCipher {
        override fun seal(plaintext: ByteArray): ByteArray =
            "FAKE".toByteArray() + plaintext

        override fun open(blob: ByteArray): ByteArray = throw SecretUnavailableException()
    }

    private fun FileSecretStore.files(): List<File> =
        File(root, "secrets").listFiles()?.filter { it.isFile }?.sortedBy { it.name }
            ?: emptyList()
}
