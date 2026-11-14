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
}
