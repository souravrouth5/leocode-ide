package dev.leocode.core

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermissions
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNoException
import org.junit.Test

class AtomicWriterTest {

    @Test
    fun `writes new content and replaces existing content`() {
        val dir = createTempDir()
        val target = File(dir, "notes.txt")

        AtomicWriter.write(target, "first".toByteArray())
        assertArrayEquals("first".toByteArray(), target.readBytes())

        AtomicWriter.write(target, "second".toByteArray())
        assertArrayEquals("second".toByteArray(), target.readBytes())
    }

    @Test
    fun `leaves no temp file after success`() {
        val dir = createTempDir()
        AtomicWriter.write(File(dir, "notes.txt"), "ok".toByteArray())
        val leftovers = dir.listFiles()?.filter { it.name.endsWith(".tmp") } ?: emptyList()
        assertTrue("temp files left: ${leftovers.map { it.name }}", leftovers.isEmpty())
    }

    @Test
    fun `concurrent writers leave one complete payload`() {
        val dir = createTempDir()
        val target = File(dir, "race.txt")
        val size = 200_000
        val payloads = (0 until 8).map { writer -> ByteArray(size) { writer.toByte() } }
        val failure = AtomicReference<Throwable?>(null)
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(payloads.size)

        payloads.forEach { payload ->
            pool.execute {
                try {
                    start.await()
                    AtomicWriter.write(target, payload)
                } catch (t: Throwable) {
                    failure.compareAndSet(null, t)
                }
            }
        }
        start.countDown()
        pool.shutdown()
        assertTrue("writers did not finish", pool.awaitTermination(30, TimeUnit.SECONDS))
        failure.get()?.let { throw AssertionError("writer failed", it) }

        val written = target.readBytes()
        assertEquals(size, written.size)
        assertTrue(
            "final content is not one of the writers' payloads",
            payloads.any { it.contentEquals(written) }
        )
        val leftovers = dir.listFiles()?.filter { it.name.endsWith(".tmp") } ?: emptyList()
        assertTrue("temp files left: ${leftovers.map { it.name }}", leftovers.isEmpty())
    }

    @Test(expected = IOException::class)
    fun `missing parent directory is an error and creates nothing`() {
        val dir = createTempDir()
        val target = File(dir, "missing/dir/file.txt")
        try {
            AtomicWriter.write(target, "nope".toByteArray())
        } finally {
            assertTrue(!target.exists())
            assertTrue(!File(dir, "missing").exists())
        }
    }

    // ------------------------------------------------------- permissions (S-07)

    /** Skips the test on a filesystem without POSIX modes. */
    private fun setMode(file: File, mode: String) {
        try {
            Files.setPosixFilePermissions(file.toPath(), PosixFilePermissions.fromString(mode))
        } catch (e: UnsupportedOperationException) {
            assumeNoException("no POSIX permissions here", e)
        }
    }

    private fun mode(file: File): String =
        PosixFilePermissions.toString(Files.getPosixFilePermissions(file.toPath()))

    @Test
    fun `an executable file stays executable after a write`() {
        val dir = createTempDir()
        val target = File(dir, "run.sh").apply { writeText("#!/bin/sh\necho old\n") }
        setMode(target, "rwxr-xr-x")

        AtomicWriter.write(target, "#!/bin/sh\necho new\n".toByteArray())

        assertEquals("rwxr-xr-x", mode(target))
        assertEquals("#!/bin/sh\necho new\n", target.readText())
    }

    @Test
    fun `a restrictive mode survives a write`() {
        val dir = createTempDir()
        val target = File(dir, "secret.txt").apply { writeText("old") }
        setMode(target, "rw-------")

        AtomicWriter.write(target, "new".toByteArray())

        assertEquals("rw-------", mode(target))
        assertEquals("new", target.readText())
    }

    @Test
    fun `a new file is not forced to an existing mode`() {
        val dir = createTempDir()
        val target = File(dir, "fresh.txt")

        AtomicWriter.write(target, "hello".toByteArray())

        assertTrue(target.isFile)
        assertArrayEquals("hello".toByteArray(), target.readBytes())
    }
}
