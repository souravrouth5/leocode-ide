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
}
