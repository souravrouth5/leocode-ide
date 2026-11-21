package dev.leocode.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileHashTest {

    private val root = createTempDir("hash")

    @Test
    fun `sha256 matches the known vector`() {
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            FileHash.sha256("abc")
        )
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            FileHash.sha256("abc".toByteArray(Charsets.UTF_8))
        )
    }

    @Test
    fun `hashing a file matches hashing its bytes`() {
        val file = File(root, "a.txt").also { it.writeText("hello") }

        assertEquals(FileHash.sha256("hello"), FileHash.sha256(file))
    }

    @Test
    fun `bounded hashing stops at the limit and marks long files`() {
        val short = File(root, "short.txt").also { it.writeText("abc") }
        val long = File(root, "long.txt").also { it.writeText("abc".repeat(100)) }

        assertEquals(FileHash.sha256(short), FileHash.sha256Bounded(short, 1024))
        assertNotEquals(FileHash.sha256(long), FileHash.sha256Bounded(long, 3))
    }

    @Test
    fun `safeHash returns null for a missing file and never throws`() {
        assertNull(FileHash.safeHash(File(root, "missing.txt")))
    }
}
