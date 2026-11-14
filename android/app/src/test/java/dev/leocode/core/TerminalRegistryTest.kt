package dev.leocode.core

import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalRegistryTest {

    /** A PTY whose output and lifetime the test controls. */
    private class FakePty(override val pid: Int = 4242) : PtyProcess {
        private val output = LinkedBlockingQueue<ByteArray>()
        private val exited = CountDownLatch(1)

        @Volatile
        private var closed = false

        override val isClosed: Boolean get() = closed

        fun emit(text: String) {
            output.put(text.toByteArray(Charsets.UTF_8))
        }

        override fun write(bytes: ByteArray): Int = bytes.size

        override fun readBlocking(maxBytes: Int): ByteArray? {
            // LinkedBlockingQueue rejects null, so destroy() wakes the reader with
            // an empty chunk and the closed flag turns that into EOF.
            val chunk = output.take()
            if (closed && chunk.isEmpty()) return null
            return chunk
        }

        override fun resize(rows: Int, cols: Int) = Unit

        override fun waitFor(): Int {
            exited.await()
            return 0
        }

        override fun destroy() {
            if (closed) return
            closed = true
            output.offer(ByteArray(0))
            exited.countDown()
        }
    }

    private class Collector : TerminalRegistry.Listener {
        val chunks = CopyOnWriteArrayList<ByteArray>()
        val exits = CopyOnWriteArrayList<Int>()
        val exited = CountDownLatch(1)

        override fun data(bytes: ByteArray) {
            chunks += bytes
        }

        override fun exit(code: Int) {
            exits += code
            exited.countDown()
        }

        fun text(): String = chunks.joinToString("") { String(it, Charsets.UTF_8) }
    }

    /** A PTY whose write blocks until the test releases it. */
    private class SlowWritePty : PtyProcess {
        override val pid: Int = 7
        private val output = LinkedBlockingQueue<ByteArray>()
        private val exited = CountDownLatch(1)
        private val gate = CountDownLatch(1)
        @Volatile
        private var closed = false

        override val isClosed: Boolean get() = closed

        override fun write(bytes: ByteArray): Int {
            gate.await()
            return bytes.size
        }

        override fun readBlocking(maxBytes: Int): ByteArray? {
            val chunk = output.take()
            if (closed && chunk.isEmpty()) return null
            return chunk
        }

        override fun resize(rows: Int, cols: Int) = Unit

        override fun waitFor(): Int {
            exited.await()
            return 0
        }

        override fun destroy() {
            if (closed) return
            closed = true
            gate.countDown()
            output.offer(ByteArray(0))
            exited.countDown()
        }
    }

    private fun workDir() = Files.createTempDirectory("leocode-term").toFile()

    private fun awaitUntil(timeoutMs: Long = 2_000, condition: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            if (condition()) return
            Thread.sleep(10)
        }
        assertTrue("condition was not met within ${timeoutMs}ms", condition())
    }

    @Test
    fun `snapshots scrollback and streams live output after attach`() {
        val fake = FakePty()
        val counts = CopyOnWriteArrayList<Int>()
        val registry = TerminalRegistry(
            spawn = { _, _, _, _ -> fake },
            onCountChanged = { counts += it }
        )
        try {
            val opened = registry.open(workDir(), emptyMap(), 24, 80)
            assertNotNull(opened)
            val sessionId = opened!!.sessionId
            assertEquals(1, registry.activeCount())
            assertTrue(counts.contains(1))

            fake.emit("hello")
            awaitUntil { snapshot(registry, sessionId).contentEquals("hello".toByteArray()) }

            val collector = Collector()
            val attachment = registry.attach(sessionId, collector)!!
            assertArrayEquals("hello".toByteArray(), attachment.snapshot.scrollback)
            assertTrue(attachment.snapshot.alive)
            attachment.start()

            fake.emit(" world")
            awaitUntil { collector.text() == " world" }
            assertEquals(" world", collector.text())
        } finally {
            registry.closeAll()
        }
        awaitUntil { counts.lastOrNull() == 0 }
    }

    @Test
    fun `detach keeps the session and a second attach replays everything`() {
        val fake = FakePty()
        val registry = TerminalRegistry(spawn = { _, _, _, _ -> fake })
        try {
            val sessionId = registry.open(workDir(), emptyMap(), 24, 80)!!.sessionId
            fake.emit("one")
            awaitUntil { snapshot(registry, sessionId).contentEquals("one".toByteArray()) }

            val first = Collector()
            val attachment = registry.attach(sessionId, first)!!
            attachment.start()
            fake.emit("two")
            awaitUntil { first.text() == "two" }

            registry.detach(sessionId)
            fake.emit("three")
            awaitUntil {
                snapshot(registry, sessionId).contentEquals("onetwothree".toByteArray())
            }

            val second = Collector()
            val again = registry.attach(sessionId, second)!!
            assertEquals("onetwothree", String(again.snapshot.scrollback))
            again.start()
            fake.emit("four")
            awaitUntil { second.text() == "four" }

            // The session id and pid survive a WebView detach/attach cycle.
            assertEquals(1, registry.list().size)
            assertEquals(fake.pid, registry.list().first().pid)
        } finally {
            registry.closeAll()
        }
    }

    @Test
    fun `attach to an exited session reports scrollback and the exit code`() {
        val fake = FakePty()
        val counts = CopyOnWriteArrayList<Int>()
        val registry = TerminalRegistry(
            spawn = { _, _, _, _ -> fake },
            onCountChanged = { counts += it }
        )
        try {
            val sessionId = registry.open(workDir(), emptyMap(), 24, 80)!!.sessionId
            fake.emit("bye")
            awaitUntil { snapshot(registry, sessionId).contentEquals("bye".toByteArray()) }

            fake.destroy()
            awaitUntil { registry.activeCount() == 0 }

            // The exited session is kept so its scrollback and exit code survive
            // a detached page (L-05); a second attach happens only after close.
            val attachment = registry.attach(sessionId, Collector())
            assertNotNull(attachment)
            assertEquals("bye", String(attachment!!.snapshot.scrollback))
            assertFalse(attachment.snapshot.alive)
            assertEquals(0, attachment.snapshot.exitCode)
        } finally {
            registry.closeAll()
        }
        assertTrue(counts.contains(0))
    }

    @Test
    fun `clamps rows and cols to a sane range`() {
        val sizes = CopyOnWriteArrayList<Pair<Int, Int>>()
        val fake = FakePty()
        val registry = TerminalRegistry(spawn = { _, _, rows, cols ->
            sizes += rows to cols
            fake
        })
        try {
            registry.open(workDir(), emptyMap(), 0, 99_999)
            assertEquals(listOf(1 to 1000), sizes.toList())
        } finally {
            registry.closeAll()
        }
    }

    @Test
    fun `a blocked PTY write does not block close`() {
        val pty = SlowWritePty()
        val registry = TerminalRegistry(spawn = { _, _, _, _ -> pty })
        val sessionId = registry.open(workDir(), emptyMap(), 24, 80)!!.sessionId
        val writer = Thread { registry.write(sessionId, byteArrayOf(1)) }
        writer.isDaemon = true
        writer.start()
        Thread.sleep(50)

        val closer = Thread { registry.close(sessionId) }
        closer.isDaemon = true
        closer.start()
        closer.join(1_000)

        assertFalse("close waited for the blocked write", closer.isAlive)
        pty.destroy()
        writer.join(1_000)
    }

    @Test
    fun `unknown session ids are rejected`() {
        val registry = TerminalRegistry(spawn = { _, _, _, _ -> null })
        assertEquals(null, registry.open(workDir(), emptyMap(), 24, 80))
        assertEquals(null, registry.attach("missing", Collector()))
        assertEquals(false, registry.write("missing", byteArrayOf(1)))
        assertEquals(false, registry.ack("missing", 1))
    }

    private fun snapshot(registry: TerminalRegistry, sessionId: String): ByteArray {
        val attachment = registry.attach(sessionId, Collector()) ?: return ByteArray(0)
        registry.detach(sessionId)
        return attachment.snapshot.scrollback
    }
}
