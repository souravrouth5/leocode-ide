package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

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
    fun `writes a pidfile while a job runs and removes it on exit`() {
        val store = PidFileStore(Files.createTempDirectory("leocode-pid").toFile())
        val done = CountDownLatch(1)
        val supervisor = ProcessSupervisor(pidFiles = store)

        try {
            val handle = supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "sleep 5"),
                    cwd = workDir(),
                    timeoutMs = 30_000
                ),
                onStdout = {},
                onStderr = {},
                onExit = { done.countDown() }
            )

            assertTrue(
                "pidfile missing for ${handle.jobId}",
                store.list().any { it.name == "${handle.jobId}.pid" }
            )
            assertTrue(supervisor.cancel(handle.jobId))
            assertTrue("cancel did not finish", done.await(5, TimeUnit.SECONDS))
            assertTrue("pidfile was not removed", store.list().isEmpty())
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
            val text = out.toString()
            assertTrue(text.contains("[output truncated at 1000 bytes]"))
            val body = text.substringBefore("\n[output truncated")
            assertTrue("captured ${body.length} chars", body.length <= 1_000)
            assertTrue(body.isNotEmpty())
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

    @Test
    fun `closes stdin so a program that reads it exits`() {
        val out = StringBuffer()
        val done = CountDownLatch(1)
        val supervisor = ProcessSupervisor()
        try {
            supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "cat; printf eof"),
                    cwd = workDir(),
                    timeoutMs = 5_000
                ),
                onStdout = { out.append(it) },
                onStderr = {},
                onExit = { done.countDown() }
            )

            assertTrue("stdin stayed open", done.await(5, TimeUnit.SECONDS))
            assertTrue(out.toString().contains("eof"))
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `writes stdin to a running job when stdin is enabled`() {
        val out = StringBuffer()
        val done = CountDownLatch(1)
        val exitCode = AtomicInteger(-1)
        val supervisor = ProcessSupervisor()
        try {
            val handle = supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "IFS= read -r line && printf 'Got:%s' \"\$line\""),
                    cwd = workDir(),
                    timeoutMs = 5_000,
                    stdin = true
                ),
                onStdout = { out.append(it) },
                onStderr = {},
                onExit = { code ->
                    exitCode.set(code)
                    done.countDown()
                }
            )

            assertTrue(supervisor.writeStdin(handle.jobId, "LeoCode\n"))
            assertTrue("process did not finish", done.await(5, TimeUnit.SECONDS))
            assertEquals(0, exitCode.get())
            assertEquals("Got:LeoCode", out.toString())
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `reports output truncation instead of dropping it silently`() {
        val out = StringBuffer()
        val done = CountDownLatch(1)
        val supervisor = ProcessSupervisor()
        try {
            supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "yes x | head -c 5000"),
                    cwd = workDir(),
                    timeoutMs = 5_000,
                    maxOutputBytes = 100
                ),
                onStdout = { out.append(it) },
                onStderr = {},
                onExit = { done.countDown() }
            )

            assertTrue(done.await(5, TimeUnit.SECONDS))
            assertTrue(out.toString().contains("[output truncated at 100 bytes]"))
        } finally {
            supervisor.close()
        }
    }

    private class FakeRootPrefs(private var enabled: Boolean = true) : RootManager.RootPrefs {
        override fun isEnabled(): Boolean = enabled
        override fun setEnabled(enabled: Boolean) {
            this.enabled = enabled
        }
    }

    private class FakeShellRunner(
        val onRun: (command: List<String>) -> RootManager.ShellResult = { RootManager.ShellResult(0, "", "") }
    ) : RootManager.ShellRunner {
        override fun run(command: List<String>, timeoutMs: Long): RootManager.ShellResult = onRun(command)
    }

    @Test
    fun `root cancel kills the recorded root pid and never calls client kill when pid is known`() {
        val fakeSu = File.createTempFile("fake_su_daemon", ".sh").apply {
            // Emulates su/magiskd spawning the target command as a separate child process
            writeText("#!/bin/sh\nsh -c \"$2\"\nexit $?\n")
            setExecutable(true)
            deleteOnExit()
        }
        val killedPids = CopyOnWriteArrayList<Pair<Int, Int>>()
        val rootPidDir = Files.createTempDirectory("leocode-root-pids").toFile()
        var aliveChecks = 0

        val manager = RootManager(
            prefs = FakeRootPrefs(true),
            shellRunner = FakeShellRunner { cmd ->
                val cmdStr = cmd.joinToString(" ")
                if (cmdStr.contains("kill -")) {
                    val sig = if (cmdStr.contains("kill -15")) 15 else 9
                    val pidRegex = Regex("kill -\\d+ -?(\\d+)")
                    val m = pidRegex.find(cmdStr)
                    val pid = m?.groupValues?.get(1)?.toIntOrNull() ?: -1
                    killedPids += pid to sig
                    RootManager.ShellResult(0, "", "")
                } else if (cmdStr.contains("cut -d' ' -f22")) {
                    aliveChecks++
                    // First check returns alive, then after kill returns dead
                    if (aliveChecks <= 1) RootManager.ShellResult(0, "123\n", "") else RootManager.ShellResult(1, "", "")
                } else {
                    RootManager.ShellResult(0, "", "")
                }
            },
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()

        val supervisor = ProcessSupervisor(rootManager = manager, rootPidDir = rootPidDir)
        val done = CountDownLatch(1)

        try {
            val handle = supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "sleep 10"),
                    cwd = workDir(),
                    timeoutMs = 30_000,
                    root = true
                ),
                onStdout = {},
                onStderr = {},
                onExit = { done.countDown() }
            )

            val rootPidFile = File(rootPidDir, "${handle.jobId}.pid")
            val rootPid = manager.awaitRootPid(rootPidFile, timeoutMs = 3_000)
            assertTrue("root pidfile did not appear", rootPid != null)
            assertTrue("root pid should be distinct from client pid", rootPid!!.pid != handle.pid)
            // Allow supervisor's background reader thread to record job.rootPid
            Thread.sleep(150)

            assertTrue(supervisor.cancel(handle.jobId))
            assertTrue(done.await(5, TimeUnit.SECONDS))

            // Verified: root cancel killed the real root pid, not the client pid
            assertTrue("expected killedPids to contain ${rootPid.pid}", killedPids.any { it.first == rootPid.pid && it.second == 15 })
            assertFalse("client pid should not have been signalled", killedPids.any { it.first == handle.pid })
        } finally {
            supervisor.close()
            fakeSu.delete()
        }
    }

    @Test
    fun `cancel immediately after start with delayed pidfile kills root pid and avoids client kill`() {
        val fakeSu = File.createTempFile("fake_su_delayed", ".sh").apply {
            // Emulates delayed pidfile appearance (~150ms)
            writeText("#!/bin/sh\nsleep 0.15\nsh -c \"$2\"\nexit $?\n")
            setExecutable(true)
            deleteOnExit()
        }
        val killedPids = CopyOnWriteArrayList<Pair<Int, Int>>()
        val rootPidDir = Files.createTempDirectory("leocode-root-pids").toFile()

        val manager = RootManager(
            prefs = FakeRootPrefs(true),
            shellRunner = FakeShellRunner { cmd ->
                val cmdStr = cmd.joinToString(" ")
                if (cmdStr.contains("kill -")) {
                    val sig = if (cmdStr.contains("-15")) 15 else 9
                    val pid = cmd.last().toIntOrNull() ?: -1
                    killedPids += pid to sig
                    RootManager.ShellResult(0, "", "")
                } else if (cmdStr.contains("cut -d' ' -f22")) {
                    RootManager.ShellResult(0, "12345\n", "")
                } else {
                    RootManager.ShellResult(0, "", "")
                }
            },
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()

        val supervisor = ProcessSupervisor(rootManager = manager, rootPidDir = rootPidDir)
        val done = CountDownLatch(1)

        try {
            val handle = supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "sleep 10"),
                    cwd = workDir(),
                    timeoutMs = 30_000,
                    root = true
                ),
                onStdout = {},
                onStderr = {},
                onExit = { done.countDown() }
            )

            // Cancel immediately without waiting for background thread or pidfile
            assertTrue(supervisor.cancel(handle.jobId))
            assertTrue(done.await(5, TimeUnit.SECONDS))

            assertFalse("client pid should not have been signalled", killedPids.any { it.first == handle.pid })
            assertTrue("real root process should have received SIGTERM", killedPids.any { it.first != handle.pid && it.second == 15 })
        } finally {
            supervisor.close()
            fakeSu.delete()
        }
    }

    @Test
    fun `root job whose pidfile never appears and exits non-zero emits root lost before exit and marks lost`() {
        val fakeSu = File.createTempFile("fake_su", ".sh").apply {
            writeText("#!/bin/sh\nexit 1\n")
            setExecutable(true)
            deleteOnExit()
        }
        val rootPidDir = Files.createTempDirectory("leocode-root-pids").toFile()
        val manager = RootManager(
            prefs = FakeRootPrefs(true),
            shellRunner = FakeShellRunner(),
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()
        assertTrue(manager.isGranted())

        val supervisor = ProcessSupervisor(rootManager = manager, rootPidDir = rootPidDir)
        val events = CopyOnWriteArrayList<String>()
        val done = CountDownLatch(1)
        var lostJobId: String? = null
        var lostReason: String? = null

        try {
            val handle = supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("echo", "test"),
                    cwd = workDir(),
                    timeoutMs = 5_000,
                    root = true
                ),
                onStdout = {},
                onStderr = {},
                onExit = {
                    events += "exit:$it"
                    done.countDown()
                },
                onRootLost = {
                    events += "lost:${it.jobId}"
                    lostJobId = it.jobId
                    lostReason = it.reason
                }
            )

            assertTrue("job did not exit", done.await(5, TimeUnit.SECONDS))
            assertEquals(listOf("lost:${handle.jobId}", "exit:1"), events.toList())
            assertEquals(handle.jobId, lostJobId)
            assertEquals("denied", lostReason)
            assertFalse("markLost must have been called", manager.isGranted())
        } finally {
            supervisor.close()
            fakeSu.delete()
        }
    }

    @Test
    fun `pidfile that appears marks root granted`() {
        val rootPidDir = Files.createTempDirectory("leocode-root-pids").toFile()
        val manager = RootManager(
            prefs = FakeRootPrefs(true),
            shellRunner = FakeShellRunner(),
            pathCandidates = listOf(sh.absolutePath),
            pathEnv = ""
        )
        // grant is not yet verified
        assertFalse(manager.isGranted())

        val supervisor = ProcessSupervisor(rootManager = manager, rootPidDir = rootPidDir)
        val done = CountDownLatch(1)

        try {
            supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "echo hello"),
                    cwd = workDir(),
                    timeoutMs = 5_000,
                    root = true
                ),
                onStdout = {},
                onStderr = {},
                onExit = { done.countDown() }
            )

            assertTrue("job did not finish", done.await(5, TimeUnit.SECONDS))
            assertTrue("markGranted should be called when pidfile appeared", manager.isGranted())
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `cancelRoot leaves non-root jobs running`() {
        val rootPidDir = Files.createTempDirectory("leocode-root-pids").toFile()
        val manager = RootManager(
            prefs = FakeRootPrefs(true),
            shellRunner = FakeShellRunner(),
            pathCandidates = listOf(sh.absolutePath),
            pathEnv = ""
        )
        val supervisor = ProcessSupervisor(rootManager = manager, rootPidDir = rootPidDir)
        val rootDone = CountDownLatch(1)
        val nonRootDone = CountDownLatch(1)

        try {
            val rootHandle = supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "sleep 10"),
                    cwd = workDir(),
                    timeoutMs = 30_000,
                    root = true
                ),
                onStdout = {},
                onStderr = {},
                onExit = { rootDone.countDown() }
            )

            val nonRootHandle = supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("/bin/sh", "-c", "sleep 10"),
                    cwd = workDir(),
                    timeoutMs = 30_000,
                    root = false
                ),
                onStdout = {},
                onStderr = {},
                onExit = { nonRootDone.countDown() }
            )

            // Cancel only root jobs
            supervisor.cancelRoot()

            assertTrue("root job should terminate", rootDone.await(5, TimeUnit.SECONDS))
            assertFalse("non-root job should still be running", nonRootDone.await(200, TimeUnit.MILLISECONDS))
            assertEquals(1, supervisor.activeCount())

            // Clean up non-root job
            supervisor.cancel(nonRootHandle.jobId)
            assertTrue("non-root job should terminate on cancel", nonRootDone.await(5, TimeUnit.SECONDS))
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `missing pidfile with stdout output is normal failed run without root lost`() {
        val fakeSu = File.createTempFile("fake_su_err", ".sh").apply {
            writeText("#!/bin/sh\necho 'some error output'\nexit 1\n")
            setExecutable(true)
            deleteOnExit()
        }
        val rootPidDir = Files.createTempDirectory("leocode-root-pids").toFile()
        val manager = RootManager(
            prefs = FakeRootPrefs(true),
            shellRunner = FakeShellRunner(),
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()

        val supervisor = ProcessSupervisor(rootManager = manager, rootPidDir = rootPidDir)
        val events = CopyOnWriteArrayList<String>()
        val done = CountDownLatch(1)

        try {
            supervisor.start(
                ProcessSupervisor.Spec(
                    argv = listOf("echo", "test"),
                    cwd = workDir(),
                    timeoutMs = 5_000,
                    root = true
                ),
                onStdout = { events += "stdout:$it" },
                onStderr = {},
                onExit = {
                    events += "exit:$it"
                    done.countDown()
                },
                onRootLost = {
                    events += "lost:${it.jobId}"
                }
            )

            assertTrue(done.await(5, TimeUnit.SECONDS))
            assertTrue(events.any { it.startsWith("stdout:") })
            assertTrue(events.contains("exit:1"))
            assertFalse("root.lost must not be emitted when stdout produced output", events.any { it.startsWith("lost:") })
            assertTrue("markLost must not be called when stdout produced output", manager.isGranted())
        } finally {
            supervisor.close()
            fakeSu.delete()
        }
    }
}
