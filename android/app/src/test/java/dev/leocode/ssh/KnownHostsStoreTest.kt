package dev.leocode.ssh

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Task 23: known_hosts stays OpenSSH-compatible and detects a changed key. */
class KnownHostsStoreTest {

    @Test
    fun `pins a host and writes an OpenSSH line with a port token`() {
        val file = knownHostsFile()
        val store = KnownHostsStore(file)
        val key = Crypto.generateEd25519().public

        store.add("127.0.0.1", 2222, key)

        val keys = store.publicKeys("127.0.0.1", 2222)
        assertEquals(1, keys.size)
        assertTrue(org.apache.sshd.common.config.keys.KeyUtils.compareKeys(key, keys.single()))

        val text = file.readText()
        assertTrue(text.startsWith("[127.0.0.1]:2222 ssh-ed25519 "))
        assertTrue(text.contains("leocode-added="))
        assertEquals(1, store.entries().size)
    }

    @Test
    fun `port 22 uses a bare host token`() {
        val file = knownHostsFile()
        val store = KnownHostsStore(file)
        store.add("github.com", 22, Crypto.generateEd25519().public)

        assertTrue(file.readText().startsWith("github.com ssh-ed25519 "))
    }

    @Test
    fun `a second key replaces the first and counts as changed`() {
        val file = knownHostsFile()
        val store = KnownHostsStore(file)
        val old = Crypto.generateEd25519().public
        val new = Crypto.generateEd25519().public

        store.add("example.com", 22, old)
        assertFalse(store.differs("example.com", 22, old))
        assertTrue(store.differs("example.com", 22, new))

        store.add("example.com", 22, new)

        assertEquals(1, store.entries().size)
        assertTrue(org.apache.sshd.common.config.keys.KeyUtils.compareKeys(
            new,
            store.publicKeys("example.com", 22).single()
        ))
    }

    @Test
    fun `delete forgets a host and reports whether it existed`() {
        val file = knownHostsFile()
        val store = KnownHostsStore(file)
        store.add("example.com", 22, Crypto.generateEd25519().public)

        assertTrue(store.delete("example.com", 22))
        assertFalse(store.delete("example.com", 22))
        assertTrue(store.publicKeys("example.com", 22).isEmpty())
        assertFalse(store.has("example.com", 22))
    }

    @Test
    fun `fingerprints use the SHA-256 prefix`() {
        val store = KnownHostsStore(knownHostsFile())
        store.add("example.com", 2200, Crypto.generateEd25519().public)

        val entry = store.entries().single()
        assertEquals("ssh-ed25519", entry.keyType)
        assertTrue(entry.fingerprint().startsWith("SHA256:"))
    }

    @Test
    fun `hashed and malformed lines are ignored`() {
        val file = knownHostsFile()
        file.writeText(
            """
            >|1|abcd|efgh ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
            ># a comment
            >broken
            >example.com ssh-rsa
            >
            """.trimMargin(">")
        )
        val store = KnownHostsStore(file)

        assertTrue(store.entries().isEmpty())
        assertTrue(store.publicKeys("example.com", 22).isEmpty())
    }

    @Test
    fun `two ports for one host stay separate`() {
        val file = knownHostsFile()
        val store = KnownHostsStore(file)
        store.add("example.com", 22, Crypto.generateEd25519().public)
        store.add("example.com", 2222, Crypto.generateEd25519().public)

        assertEquals(2, store.entries().size)
        assertTrue(store.has("example.com", 22))
        assertTrue(store.has("example.com", 2222))
    }

    private fun knownHostsFile(): File {
        val root = java.nio.file.Files.createTempDirectory("known-hosts").toFile()
        root.deleteOnExit()
        val file = File(root, "ssh/known_hosts")
        file.parentFile?.mkdirs()
        return file
    }
}
