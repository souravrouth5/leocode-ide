package dev.leocode.core

import java.io.File
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
}
