package dev.leocode.core

import dev.leocode.bridge.BridgeException
import dev.leocode.bridge.ErrorCode
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class RootManagerTest {

    private class FakeRootPrefs(private var enabled: Boolean = false) : RootManager.RootPrefs {
        override fun isEnabled(): Boolean = enabled
        override fun setEnabled(enabled: Boolean) {
            this.enabled = enabled
        }
    }

    private class FakeShellRunner : RootManager.ShellRunner {
        var nextExitCode = 0
        var nextStdout = "uid=0(root) gid=0(root)"
        var nextStderr = ""
        val executedCommands = mutableListOf<List<String>>()

        override fun run(command: List<String>, timeoutMs: Long): RootManager.ShellResult {
            executedCommands.add(command)
            return RootManager.ShellResult(nextExitCode, nextStdout, nextStderr)
        }
    }

    @Test
    fun `su unavailable when no su binary exists`() {
        val prefs = FakeRootPrefs()
        val runner = FakeShellRunner()
        val manager = RootManager(
            prefs = prefs,
            shellRunner = runner,
            pathCandidates = listOf("/nonexistent/bin/su"),
            pathEnv = ""
        )

        assertNull(manager.findSuBinary())
        assertFalse(manager.isAvailable())
        assertFalse(manager.isEnabled())
        assertFalse(manager.isGranted())

        val status = manager.status()
        assertEquals(false, status.available)
        assertEquals(false, status.granted)
        assertEquals(false, status.enabled)

        try {
            manager.requestGrant()
            fail("expected E_ROOT_UNAVAILABLE")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_UNAVAILABLE, e.errorCode)
        }

        try {
            manager.setEnabled(true)
            fail("expected E_ROOT_UNAVAILABLE")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_UNAVAILABLE, e.errorCode)
        }

        // Never invoked su
        assertTrue(runner.executedCommands.isEmpty())
    }

    @Test
    fun `su available but not enabled never prompts`() {
        val tempSu = File.createTempFile("fake_su", "")
        tempSu.deleteOnExit()

        val prefs = FakeRootPrefs(enabled = false)
        val runner = FakeShellRunner()
        val manager = RootManager(
            prefs = prefs,
            shellRunner = runner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )

        assertEquals(tempSu.absolutePath, manager.findSuBinary())
        assertTrue(manager.isAvailable())
        assertFalse(manager.isEnabled())
        assertFalse(manager.isGranted())

        val status = manager.status()
        assertEquals(true, status.available)
        assertEquals(false, status.granted)
        assertEquals(false, status.enabled)

        // Strict requirement: status and checks must NEVER execute su when disabled
        assertTrue(runner.executedCommands.isEmpty())
        tempSu.delete()
    }

    @Test
    fun `requestGrant denied throws E_ROOT_DENIED and keeps disabled`() {
        val tempSu = File.createTempFile("fake_su", "")
        tempSu.deleteOnExit()

        val prefs = FakeRootPrefs(enabled = false)
        val runner = FakeShellRunner().apply { nextExitCode = 1 }
        val manager = RootManager(
            prefs = prefs,
            shellRunner = runner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )

        try {
            manager.requestGrant()
            fail("expected E_ROOT_DENIED")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_DENIED, e.errorCode)
        }

        assertEquals(1, runner.executedCommands.size)
        assertEquals(listOf(tempSu.absolutePath, "-c", "id"), runner.executedCommands.first())
        assertFalse(manager.isEnabled())
        assertFalse(prefs.isEnabled())
        tempSu.delete()
    }

    @Test
    fun `requestGrant approved enables root mode`() {
        val tempSu = File.createTempFile("fake_su", "")
        tempSu.deleteOnExit()

        val prefs = FakeRootPrefs(enabled = false)
        val runner = FakeShellRunner().apply { nextExitCode = 0 }
        val manager = RootManager(
            prefs = prefs,
            shellRunner = runner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )

        val granted = manager.requestGrant()
        assertTrue(granted)
        assertTrue(manager.isEnabled())
        assertTrue(prefs.isEnabled())

        val status = manager.status()
        assertEquals(true, status.available)
        assertEquals(true, status.granted)
        assertEquals(true, status.enabled)

        // Toggling off
        manager.setEnabled(false)
        assertFalse(manager.isEnabled())
        assertFalse(prefs.isEnabled())
        tempSu.delete()
    }

    @Test
    fun `kill invokes su with kill command`() {
        val tempSu = File.createTempFile("fake_su", "")
        tempSu.deleteOnExit()

        val prefs = FakeRootPrefs(enabled = true)
        val runner = FakeShellRunner()
        val manager = RootManager(
            prefs = prefs,
            shellRunner = runner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )

        val ok = manager.kill(4567, 15)
        assertTrue(ok)
        assertEquals(1, runner.executedCommands.size)
        assertEquals(
            listOf(tempSu.absolutePath, "-c", "kill -15 -4567 2>/dev/null || kill -15 4567 2>/dev/null"),
            runner.executedCommands.first()
        )
        tempSu.delete()
    }

    @Test
    fun `quoteArg handles spaces quotes dollars backticks newlines and empty`() {
        // Simple
        assertEquals("'hello'", RootManager.quoteArg("hello"))
        // Spaces
        assertEquals("'hello world'", RootManager.quoteArg("hello world"))
        // Single quote
        assertEquals("'it'\\''s'", RootManager.quoteArg("it's"))
        // Double quotes
        assertEquals("'\"quoted\"'", RootManager.quoteArg("\"quoted\""))
        // Dollar variable
        assertEquals("'\$HOME'", RootManager.quoteArg("\$HOME"))
        // Backticks
        assertEquals("'`whoami`'", RootManager.quoteArg("`whoami`"))
        // Newline
        assertEquals("'line1\nline2'", RootManager.quoteArg("line1\nline2"))
        // Empty string
        assertEquals("''", RootManager.quoteArg(""))
    }

    @Test
    fun `buildShellCommand constructs safe command with cd and exec`() {
        val cmd = RootManager.buildShellCommand(
            argv = listOf("python3", "script.py", "arg with space", "quote'test", "\$VAR"),
            cwd = File("/data/user/0/dev.leocode/files/workspaces/default")
        )
        assertEquals(
            "cd '/data/user/0/dev.leocode/files/workspaces/default' && exec 'python3' 'script.py' 'arg with space' 'quote'\\''test' '\$VAR'",
            cmd
        )
    }

    @Test
    fun `ProcessShellRunner timeout destroys process forcibly and returns timeout result`() {
        var destroyed = false
        val blockingIn = object : java.io.InputStream() {
            @Volatile var closed = false
            override fun read(): Int {
                while (!closed) {
                    try { Thread.sleep(20) } catch (_: InterruptedException) { break }
                }
                return -1
            }
            override fun close() {
                closed = true
            }
        }
        val fakeProcess = object : Process() {
            override fun getOutputStream(): java.io.OutputStream = java.io.ByteArrayOutputStream()
            override fun getInputStream(): java.io.InputStream = blockingIn
            override fun getErrorStream(): java.io.InputStream = java.io.ByteArrayInputStream(ByteArray(0))
            override fun waitFor(): Int = 0
            override fun waitFor(timeout: Long, unit: java.util.concurrent.TimeUnit): Boolean {
                Thread.sleep(unit.toMillis(timeout))
                return false
            }
            override fun exitValue(): Int = 0
            override fun destroy() {}
            override fun destroyForcibly(): Process {
                destroyed = true
                blockingIn.close()
                return this
            }
        }

        val runner = RootManager.ProcessShellRunner(start = { fakeProcess })
        val start = System.currentTimeMillis()
        val result = runner.run(listOf("su"), timeoutMs = 300)
        val elapsed = System.currentTimeMillis() - start

        assertTrue("Execution took ${elapsed}ms, expected < 1500ms", elapsed < 1500)
        assertEquals(-1, result.exitCode)
        assertEquals("timeout after 300ms", result.stderr)
        assertTrue(destroyed)
    }

    @Test
    fun `ProcessShellRunner caps output to 64 KiB without blocking full pipe`() {
        val oneMb = ByteArray(1024 * 1024) { 'b'.code.toByte() }
        val fakeProcess = object : Process() {
            override fun getOutputStream(): java.io.OutputStream = java.io.ByteArrayOutputStream()
            override fun getInputStream(): java.io.InputStream = java.io.ByteArrayInputStream(ByteArray(0))
            override fun getErrorStream(): java.io.InputStream = java.io.ByteArrayInputStream(oneMb)
            override fun waitFor(): Int = 42
            override fun waitFor(timeout: Long, unit: java.util.concurrent.TimeUnit): Boolean = true
            override fun exitValue(): Int = 42
            override fun destroy() {}
            override fun destroyForcibly(): Process = this
        }

        val runner = RootManager.ProcessShellRunner(start = { fakeProcess })
        val result = runner.run(listOf("su"), timeoutMs = 5_000)

        assertEquals(42, result.exitCode)
        assertEquals(64 * 1024, result.stderr.toByteArray(Charsets.UTF_8).size)
        assertTrue(result.stderr.all { it == 'b' })
    }

    @Test
    fun `ProcessShellRunner start throws returns exit minus one and does not escape`() {
        val runner = RootManager.ProcessShellRunner(start = {
            throw java.io.IOException("spawn failure")
        })
        val result = runner.run(listOf("su"), timeoutMs = 1_000)
        assertEquals(-1, result.exitCode)
        assertEquals("", result.stdout)
        assertEquals("spawn failure", result.stderr)
    }

    @Test
    fun `status and isGranted make zero shell calls and use grant cache`() {
        val tempSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val prefs = FakeRootPrefs(enabled = true)
        val runner = FakeShellRunner().apply { nextExitCode = 0 }
        val manager = RootManager(
            prefs = prefs,
            shellRunner = runner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )

        // Before any request: status granted is false, zero shell calls
        val initialStatus = manager.status()
        assertTrue(initialStatus.available)
        assertTrue(initialStatus.enabled)
        assertFalse(initialStatus.granted)
        assertFalse(manager.isGranted())
        assertTrue(runner.executedCommands.isEmpty())

        // Request grant
        val granted = manager.requestGrant()
        assertTrue(granted)
        assertEquals(1, runner.executedCommands.size)

        // After successful requestGrant: status granted is true, isGranted is true, still 1 shell call
        val postStatus = manager.status()
        assertTrue(postStatus.granted)
        assertTrue(manager.isGranted())
        assertEquals(1, runner.executedCommands.size)

        tempSu.delete()
    }

    @Test
    fun `requestGrant timeout or denial updates cache and canUseRoot`() {
        val tempSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val prefs = FakeRootPrefs(enabled = true)
        val runner = FakeShellRunner()
        val manager = RootManager(
            prefs = prefs,
            shellRunner = runner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )

        // Timeout case
        runner.nextExitCode = -1
        runner.nextStderr = "timeout after 30000ms"
        try {
            manager.requestGrant()
            fail("expected E_ROOT_DENIED on timeout")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_DENIED, e.errorCode)
            assertTrue("Expected message to mention timeout: ${e.message}", e.message.contains("timed out") || e.message.contains("timeout"))
        }
        assertFalse(manager.canUseRoot())
        assertFalse(prefs.isEnabled())

        // Mark granted restores canUseRoot if enabled
        prefs.setEnabled(true)
        manager.markGranted()
        assertTrue(manager.canUseRoot())

        // Mark lost keeps prefs enabled but disables canUseRoot
        manager.markLost()
        assertTrue(prefs.isEnabled())
        assertFalse(manager.canUseRoot())

        // setEnabled(false) resets grant cache to null
        manager.setEnabled(false)
        assertFalse(prefs.isEnabled())
        // canUseRoot is false now only because prefs is disabled (not because grantCache == false)
        prefs.setEnabled(true)
        assertTrue(manager.canUseRoot())

        tempSu.delete()
    }

    @Test
    fun `default su paths include debug_ramdisk and system_ext but not data adb`() {
        assertTrue(RootManager.DEFAULT_SU_PATHS.contains("/debug_ramdisk/su"))
        assertTrue(RootManager.DEFAULT_SU_PATHS.contains("/system_ext/bin/su"))
        assertFalse(RootManager.DEFAULT_SU_PATHS.any { it.startsWith("/data/adb") })
    }

    @Test
    fun `buildRootCommand and buildRootShell construct expected commands with quoting`() {
        val pidFile = File("/tmp/test.pid")
        val cwd = File("/data/work")
        val simpleCmd = RootManager.buildRootCommand(listOf("sh", "run.sh"), cwd, pidFile)
        assertEquals(
            "echo \"\$\$ \$(cut -d' ' -f22 /proc/\$\$/stat)\" > '/tmp/test.pid' && chmod 0644 '/tmp/test.pid' && cd '/data/work' && exec 'sh' 'run.sh'",
            simpleCmd
        )

        val shellCmd = RootManager.buildRootShell(pidFile)
        assertEquals(
            "echo \"\$\$ \$(cut -d' ' -f22 /proc/\$\$/stat)\" > '/tmp/test.pid' && chmod 0644 '/tmp/test.pid' && exec /system/bin/sh -i",
            shellCmd
        )

        val complexCmd = RootManager.buildRootCommand(
            listOf("tool", "arg with space", "quote'test", "\$VAR", "`whoami`", "a;b"),
            File("/path with space"),
            File("/pid's dir/test.pid")
        )
        assertEquals(
            "echo \"\$\$ \$(cut -d' ' -f22 /proc/\$\$/stat)\" > '/pid'\\''s dir/test.pid' && chmod 0644 '/pid'\\''s dir/test.pid' && cd '/path with space' && exec 'tool' 'arg with space' 'quote'\\''test' '\$VAR' '`whoami`' 'a;b'",
            complexCmd
        )
    }

    @Test
    fun `parseRootPidFile parses valid text and rejects invalid`() {
        assertEquals(RootManager.RootPid(1234, 56789L), RootManager.parseRootPidFile("1234 56789"))
        assertEquals(RootManager.RootPid(1234, 56789L), RootManager.parseRootPidFile("1234 56789\n"))
        assertEquals(RootManager.RootPid(1234, 56789L), RootManager.parseRootPidFile("  1234   56789  \r\n"))

        assertNull(RootManager.parseRootPidFile(""))
        assertNull(RootManager.parseRootPidFile("   "))
        assertNull(RootManager.parseRootPidFile("1234"))
        assertNull(RootManager.parseRootPidFile("abc 56789"))
        assertNull(RootManager.parseRootPidFile("1234 abc"))
        assertNull(RootManager.parseRootPidFile("0 56789"))
        assertNull(RootManager.parseRootPidFile("1 56789"))
        assertNull(RootManager.parseRootPidFile("-5 56789"))
        assertNull(RootManager.parseRootPidFile("1234 56789 extra"))
        assertNull(RootManager.parseRootPidFile("1234 -56789"))
    }

    @Test
    fun `awaitRootPid returns when file appears and null on timeout`() {
        val tempPidFile = File.createTempFile("await_pid", ".tmp")
        tempPidFile.delete()

        val manager = RootManager(
            prefs = FakeRootPrefs(),
            shellRunner = FakeShellRunner(),
            pathCandidates = emptyList()
        )

        // Delayed file appearance
        val writerThread = Thread {
            Thread.sleep(100)
            tempPidFile.writeText("4321 98765\n")
        }
        writerThread.start()

        val found = manager.awaitRootPid(tempPidFile, timeoutMs = 2_000, pollMs = 25)
        assertEquals(RootManager.RootPid(4321, 98765L), found)
        tempPidFile.delete()

        // Never appears
        val nonExistent = File("/tmp/nonexistent_${System.currentTimeMillis()}.pid")
        val start = System.currentTimeMillis()
        val notFound = manager.awaitRootPid(nonExistent, timeoutMs = 150, pollMs = 25)
        val elapsed = System.currentTimeMillis() - start
        assertNull(notFound)
        assertTrue("Elapsed was ${elapsed}ms, expected >= 100ms", elapsed >= 100)
    }

    @Test
    fun `isRootPidAlive verifies process existence and start time matching`() {
        val tempSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val prefs = FakeRootPrefs(enabled = true)
        val runner = object : RootManager.ShellRunner {
            var exitCode = 0
            var output = "56789"
            val commands = mutableListOf<List<String>>()

            override fun run(command: List<String>, timeoutMs: Long): RootManager.ShellResult {
                commands.add(command)
                return RootManager.ShellResult(exitCode, output, "")
            }
        }

        val manager = RootManager(
            prefs = prefs,
            shellRunner = runner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()

        val rp = RootManager.RootPid(1234, 56789L)

        // Matching start time and alive: exactly one su command
        assertTrue(manager.isRootPidAlive(rp))
        assertEquals(1, runner.commands.size)
        assertEquals(
            listOf(tempSu.absolutePath, "-c", "kill -0 1234 2>/dev/null && cut -d' ' -f22 /proc/1234/stat"),
            runner.commands.last()
        )

        // Process dead (exitCode non-zero): exactly one call
        runner.commands.clear()
        runner.exitCode = 1
        runner.output = ""
        assertFalse(manager.isRootPidAlive(rp))
        assertEquals(1, runner.commands.size)

        // Process alive but start time differs (pid recycled)
        runner.commands.clear()
        runner.exitCode = 0
        runner.output = "99999"
        assertFalse(manager.isRootPidAlive(rp))
        assertEquals(1, runner.commands.size)

        // canUseRoot false: 0 su commands
        manager.markLost()
        runner.commands.clear()
        assertFalse(manager.isRootPidAlive(rp))
        assertTrue(runner.commands.isEmpty())

        tempSu.delete()
    }
}

