package dev.leocode.core

import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class RuntimeStateStoreTest {

    private fun store() = RuntimeStateStore(
        Files.createTempDirectory("leocode-runtime-state").resolve("state.properties").toFile()
    )

    @Test
    fun `records and reads the highest installed version`() {
        val store = store()
        assertNull(store.installedVersion("python"))

        store.record("python", 31410)

        assertEquals(31410, store.installedVersion("python"))
        assertEquals(31410, store.installedVersion("python"))
        assertNull(store.installedVersion("node"))
    }

    @Test
    fun `a second instance sees the recorded version`() {
        val file = Files.createTempDirectory("leocode-runtime-state")
            .resolve("state.properties").toFile()
        RuntimeStateStore(file).record("python", 31410)

        assertEquals(31410, RuntimeStateStore(file).installedVersion("python"))
    }

    @Test
    fun `clear removes only the requested runtime`() {
        val store = store()
        store.record("python", 1)
        store.record("node", 2)

        store.clear("python")

        assertNull(store.installedVersion("python"))
        assertEquals(2, store.installedVersion("node"))
    }

    @Test
    fun `a corrupt file reads as empty and is replaced on the next write`() {
        val file = Files.createTempDirectory("leocode-runtime-state")
            .resolve("state.properties").toFile()
        file.writeText("not a properties file\u0000")

        val store = RuntimeStateStore(file)
        assertNull(store.installedVersion("python"))
        store.record("python", 7)
        assertEquals(7, RuntimeStateStore(file).installedVersion("python"))
        assertFalse(file.parentFile.resolve("state.properties.tmp").exists())
    }
}
