package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ProcessSupervisorTest {

    private val sh = File("/bin/sh")

    @Before
    fun requireShell() {
        assumeTrue(sh.canExecute())
    }

    private fun workDir(): File =
        java.nio.file.Files.createTempDirectory("leocode-proc").toFile()

    @Test
    fun `captures exit code and both streams`() {
        val out = StringBuffer()
        val err = StringBuffer()
        val codes = CopyOnWriteArrayList<Int>()
        val done = CountDownLatch(1)
        val supervisor = ProcessSupervisor()

        try {
            supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "printf hello; printf oops >&2; exit 7"),
                    cwd = workDir(),
                    timeoutMs = 5_000
                ),
                onStdout = { out.append(it) },
                onStderr = { err.append(it) },
                onExit = { codes += it; done.countDown() }
            )

            assertTrue("process did not exit", done.await(5, TimeUnit.SECONDS))
            assertEquals(listOf(7), codes)
            assertEquals("hello", out.toString())
            assertEquals("oops", err.toString())
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `timeout kills the process and reports code -1`() {
        val codes = CopyOnWriteArrayList<Int>()
        val done = CountDownLatch(1)
        val supervisor = ProcessSupervisor()

        try {
            supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "sleep 5"),
                    cwd = workDir(),
                    timeoutMs = 250
                ),
                onStdout = {},
                onStderr = {},
                onExit = { codes += it; done.countDown() }
            )

            assertTrue("timeout did not fire", done.await(5, TimeUnit.SECONDS))
            assertEquals(listOf(-1), codes)
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `cancel stops a running process and exits once`() {
        val codes = CopyOnWriteArrayList<Int>()
        val done = CountDownLatch(1)
        val supervisor = ProcessSupervisor()

        try {
            val handle = supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "sleep 5"),
                    cwd = workDir(),
                    timeoutMs = 30_000
                ),
                onStdout = {},
                onStderr = {},
                onExit = { codes += it; done.countDown() }
            )

            assertTrue(supervisor.cancel(handle.jobId))
            assertTrue("cancel did not finish", done.await(5, TimeUnit.SECONDS))
            assertEquals(1, codes.size)
            assertFalse(supervisor.cancel("no-such-job"))
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `output is capped per stream`() {
        val out = StringBuffer()
        val done = CountDownLatch(1)
        val supervisor = ProcessSupervisor()

        try {
            supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "printf '%0100000d' 0"),
                    cwd = workDir(),
                    timeoutMs = 5_000,
                    maxOutputBytes = 1_000
                ),
                onStdout = { out.append(it) },
                onStderr = {},
                onExit = { done.countDown() }
            )

            assertTrue("process did not exit", done.await(5, TimeUnit.SECONDS))
            assertTrue("captured ${out.length} bytes", out.length <= 1_000)
            assertTrue(out.isNotEmpty())
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `multi-byte characters are never split across events`() {
        val text = "é漢🙂".repeat(2_000)
        val chunks = CopyOnWriteArrayList<String>()
        val done = CountDownLatch(1)
        val supervisor = ProcessSupervisor()

        try {
            supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "printf '%s' '$text'"),
                    cwd = workDir(),
                    timeoutMs = 5_000
                ),
                onStdout = { chunks += it },
                onStderr = {},
                onExit = { done.countDown() }
            )

            assertTrue("process did not exit", done.await(5, TimeUnit.SECONDS))
            assertFalse(chunks.any { it.contains('\uFFFD') })
            assertEquals(text, chunks.joinToString(""))
        } finally {
            supervisor.close()
        }
    }
}
