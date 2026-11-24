package dev.leocode.core

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OrphanReaperTest {

    private fun tempStore(): PidFileStore =
        PidFileStore(Files.createTempDirectory("leocode-reap").toFile())

    private fun pidFile(store: PidFileStore, name: String, text: String): File {
        val dir = store.fileFor(name).parentFile!!
        dir.mkdirs()
        return File(dir, "$name.pid").apply { writeText(text) }
    }

    @Test
    fun `kills a matching orphan group and removes the pidfile`() {
        val store = tempStore()
        val file = pidFile(store, "term-1", "4242 777 term\n")
        val signals = mutableListOf<Pair<Int, Int>>()
        var alive = true

        val reaper = OrphanReaper(
            store,
            kill = { pid, signal ->
                signals += pid to signal
                if (signal == 15) alive = false
            },
            startTime = { if (alive) 777L else null },
            sleep = {}
        )

        assertEquals(1, reaper.reap())
        assertEquals(listOf(4242 to 15), signals)
        assertFalse(file.exists())
    }

    @Test
    fun `sends SIGKILL when SIGTERM is ignored`() {
        val store = tempStore()
        pidFile(store, "proc-1", "51 900 proc\n")
        val signals = mutableListOf<Pair<Int, Int>>()

        val reaper = OrphanReaper(
            store,
            kill = { pid, signal -> signals += pid to signal },
            startTime = { 900L },
            sleep = {}
        )

        assertEquals(1, reaper.reap())
        assertEquals(listOf(51 to 15, 51 to 9), signals)
    }

    @Test
    fun `never kills a recycled pid`() {
        val store = tempStore()
        val file = pidFile(store, "term-2", "4242 777 term\n")
        val signals = mutableListOf<Pair<Int, Int>>()

        val reaper = OrphanReaper(
            store,
            kill = { pid, signal -> signals += pid to signal },
            startTime = { 999L },
            sleep = {}
        )

        assertEquals(0, reaper.reap())
        assertTrue(signals.isEmpty())
        assertFalse(file.exists())
    }

    @Test
    fun `deletes unreadable pidfiles`() {
        val store = tempStore()
        val file = pidFile(store, "broken", "not-a-pid\n")

        val reaper = OrphanReaper(store, kill = { _, _ -> }, startTime = { null }, sleep = {})

        assertEquals(0, reaper.reap())
        assertFalse(file.exists())
    }

    @Test
    fun `never signals pid 1, the app's own pid or its own group`() {
        val store = tempStore()
        pidFile(store, "one", "1 500 term\n")
        val (selfPid, selfGroup) = ProcessStartTime.selfIds() ?: (0 to 0)
        if (selfPid > 1) pidFile(store, "self", "$selfPid 500 term\n")
        if (selfGroup > 1) pidFile(store, "group", "$selfGroup 500 term\n")
        val signals = mutableListOf<Pair<Int, Int>>()

        val reaper = OrphanReaper(
            store,
            kill = { pid, signal -> signals += pid to signal },
            startTime = { 500L },
            sleep = {}
        )

        assertEquals(0, reaper.reap())
        assertTrue(signals.isEmpty())
    }

    @Test
    fun `an unknown start time is never treated as the orphan`() {
        val store = tempStore()
        pidFile(store, "zero", "4242 0 term\n")
        val signals = mutableListOf<Pair<Int, Int>>()

        val reaper = OrphanReaper(
            store,
            kill = { pid, signal -> signals += pid to signal },
            startTime = { 777L },
            sleep = {}
        )

        assertEquals(0, reaper.reap())
        assertTrue(signals.isEmpty())
    }

    @Test
    fun `root kinds are skipped and their files kept`() {
        val store = tempStore()
        val rootProc = pidFile(store, "root-p", "1234 500 root-proc\n")
        val rootTerm = pidFile(store, "root-t", "5678 600 root-term\n")
        val normalProc = pidFile(store, "normal-p", "9999 700 proc\n")
        val signals = mutableListOf<Pair<Int, Int>>()

        var alive = true
        val reaper = OrphanReaper(
            store,
            kill = { pid, signal ->
                signals += pid to signal
                if (signal == 15) alive = false
            },
            startTime = { if (alive) 700L else null },
            sleep = {}
        )

        val killed = reaper.reap()
        assertEquals(1, killed)
        assertEquals(listOf(9999 to 15), signals)
        assertTrue("root-proc file must be kept", rootProc.exists())
        assertTrue("root-term file must be kept", rootTerm.exists())
        assertFalse("normal proc file must be deleted", normalProc.exists())
    }
}
