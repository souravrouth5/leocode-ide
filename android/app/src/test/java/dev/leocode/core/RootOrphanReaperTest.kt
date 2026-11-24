package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class RootOrphanReaperTest {

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

    private fun tempDir(): File = Files.createTempDirectory("leocode-root-reap").toFile()

    @Test
    fun `canUseRoot false does not make shell calls and keeps files`() {
        val dir = tempDir()
        val pidFile = File(dir, "root-1.pid").apply { writeText("4242 777\n") }
        var shellCalled = false

        val fakeSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = RootManager(
            prefs = FakeRootPrefs(enabled = false),
            shellRunner = FakeShellRunner {
                shellCalled = true
                RootManager.ShellResult(0, "", "")
            },
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        // Root is disabled so canUseRoot() is false
        assertFalse(manager.canUseRoot())

        val reaper = RootOrphanReaper(dir, manager, sleep = {})
        val reaped = reaper.reapPending()

        assertEquals(0, reaped)
        assertFalse("shell was called when canUseRoot is false", shellCalled)
        assertTrue("pidfile should be kept when canUseRoot is false", pidFile.exists())
    }

    @Test
    fun `stale start time does not kill and deletes file`() {
        val dir = tempDir()
        val pidFile = File(dir, "root-2.pid").apply { writeText("4242 777\n") }
        val signals = mutableListOf<Pair<Int, Int>>()

        val fakeSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = RootManager(
            prefs = FakeRootPrefs(enabled = true),
            shellRunner = FakeShellRunner { cmd ->
                val cmdStr = cmd.joinToString(" ")
                if (cmdStr.contains("cut -d' ' -f22")) {
                    // Return different start time (888 != 777)
                    RootManager.ShellResult(0, "888\n", "")
                } else if (cmdStr.contains("kill -")) {
                    signals += 4242 to 15
                    RootManager.ShellResult(0, "", "")
                } else {
                    RootManager.ShellResult(0, "", "")
                }
            },
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()
        assertTrue(manager.canUseRoot())

        val reaper = RootOrphanReaper(dir, manager, sleep = {})
        val reaped = reaper.reapPending()

        assertEquals(0, reaped)
        assertTrue("no signals should be sent for stale start time", signals.isEmpty())
        assertFalse("pidfile should be deleted", pidFile.exists())
    }

    @Test
    fun `alive and matching process is killed with TERM then KILL and deletes file`() {
        val dir = tempDir()
        val pidFile = File(dir, "root-3.pid").apply { writeText("4242 777\n") }
        val signals = mutableListOf<String>()

        val fakeSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = RootManager(
            prefs = FakeRootPrefs(enabled = true),
            shellRunner = FakeShellRunner { cmd ->
                val cmdStr = cmd.joinToString(" ")
                if (cmdStr.contains("cut -d' ' -f22")) {
                    // Still alive and matching
                    RootManager.ShellResult(0, "777\n", "")
                } else if (cmdStr.contains("kill -15")) {
                    signals += "TERM"
                    RootManager.ShellResult(0, "", "")
                } else if (cmdStr.contains("kill -9")) {
                    signals += "KILL"
                    RootManager.ShellResult(0, "", "")
                } else {
                    RootManager.ShellResult(0, "", "")
                }
            },
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()
        assertTrue(manager.canUseRoot())

        val reaper = RootOrphanReaper(dir, manager, sleep = {})
        val reaped = reaper.reapPending()

        assertEquals(1, reaped)
        assertEquals(listOf("TERM", "KILL"), signals)
        assertFalse("pidfile should be deleted", pidFile.exists())
    }

    @Test
    fun `unparseable file is deleted with no kill`() {
        val dir = tempDir()
        val pidFile = File(dir, "root-broken.pid").apply { writeText("garbage\n") }
        var shellCalled = false

        val fakeSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = RootManager(
            prefs = FakeRootPrefs(enabled = true),
            shellRunner = FakeShellRunner {
                shellCalled = true
                RootManager.ShellResult(0, "", "")
            },
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()

        val reaper = RootOrphanReaper(dir, manager, sleep = {})
        val reaped = reaper.reapPending()

        assertEquals(0, reaped)
        assertFalse("shell should not be called for unparseable pidfile", shellCalled)
        assertFalse("unparseable file should be deleted", pidFile.exists())
    }

    @Test
    fun `active id is never signalled and its file is kept while stale id is reaped`() {
        val dir = tempDir()
        val activeFile = File(dir, "active-job.pid").apply { writeText("4242 777\n") }
        val staleFile = File(dir, "stale-job.pid").apply { writeText("5353 888\n") }
        val signals = mutableListOf<Pair<Int, Int>>()

        val fakeSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = RootManager(
            prefs = FakeRootPrefs(enabled = true),
            shellRunner = FakeShellRunner { cmd ->
                val cmdStr = cmd.joinToString(" ")
                if (cmdStr.contains("cut -d' ' -f22")) {
                    RootManager.ShellResult(0, "888\n", "")
                } else if (cmdStr.contains("kill -15")) {
                    signals += 5353 to 15
                    RootManager.ShellResult(0, "", "")
                } else {
                    RootManager.ShellResult(0, "", "")
                }
            },
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        manager.markGranted()

        val reaper = RootOrphanReaper(
            dir = dir,
            rootManager = manager,
            isActive = { id -> id == "active-job" },
            sleep = {}
        )
        val reaped = reaper.reapPending()

        assertEquals(1, reaped)
        assertEquals(listOf(5353 to 15), signals)
        assertTrue("active pidfile must be kept", activeFile.exists())
        assertFalse("stale pidfile must be deleted", staleFile.exists())
    }
}
