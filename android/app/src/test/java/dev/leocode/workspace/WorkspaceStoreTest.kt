package dev.leocode.workspace

import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class WorkspaceStoreTest {

    private val root = createTempDir("workspace-store")
    private val workspace = Workspace(root).also { it.ensure() }
    private val trash = Trash(File(workspace.root, ".trash"))

    private fun store(clock: () -> Long = { 1_000L }): WorkspaceStore =
        WorkspaceStore(workspace, trash, now = clock).also { it.ensure() }

    @Test
    fun `ensure creates the default workspace`() {
        val store = store()

        assertEquals(WorkspaceStore.DEFAULT_ID, store.activeId())
        val records = store.list()
        assertEquals(1, records.size)
        assertEquals(WorkspaceStore.DEFAULT_NAME, records.single().name)
        assertTrue(store.directory(WorkspaceStore.DEFAULT_ID).isDirectory)
    }

    @Test
    fun `create and open persist across a reload`() {
        val first = store()
        val created = first.create("  Notes  ")
        assertFalse(created.id == WorkspaceStore.DEFAULT_ID)
        assertEquals("Notes", created.name)

        first.open(created.id)
        assertEquals(created.id, first.activeId())

        val reloaded = store()
        assertEquals(created.id, reloaded.activeId())
        assertTrue(reloaded.list().any { it.id == created.id && it.name == "Notes" })
        assertTrue(reloaded.directory(created.id).isDirectory)
    }

    @Test
    fun `rename changes the display name but keeps the directory`() {
        val store = store()
        val created = store.create("Old")
        val before = store.directory(created.id)

        val renamed = store.rename(created.id, "New name")

        assertEquals("New name", renamed.name)
        assertEquals(before, store.directory(renamed.id))
        assertTrue(before.isDirectory)
        assertEquals(
            "New name",
            store(clock = { 2_000L }).list().first { it.id == created.id }.name
        )
    }

    @Test
    fun `delete moves the directory to the trash and falls back to default`() {
        val store = store()
        val created = store.create("Temp")
        val dir = store.directory(created.id)
        File(dir, "note.txt").writeText("hello")
        store.open(created.id)

        assertTrue(store.delete(created.id))

        assertFalse(dir.exists())
        assertEquals(WorkspaceStore.DEFAULT_ID, store.activeId())
        assertFalse(store.list().any { it.id == created.id })
        val trashed = trash.directories().flatMap { it.listFiles()?.toList() ?: emptyList() }
        assertTrue(trashed.any { File(it, "note.txt").isFile })
    }

    @Test
    fun `the default workspace cannot be deleted`() {
        val store = store()
        try {
            store.delete(WorkspaceStore.DEFAULT_ID)
            fail("default workspace was deleted")
        } catch (e: SecurityException) {
            assertTrue(store.list().any { it.id == WorkspaceStore.DEFAULT_ID })
        }
    }

    @Test
    fun `invalid names and ids are rejected`() {
        val store = store()
        for (name in listOf("", "   ", "a/b", "..", "x".repeat(65))) {
            try {
                store.create(name)
                fail("accepted workspace name: $name")
            } catch (_: IllegalArgumentException) {
                // expected
            }
        }
        try {
            store.directory("../escape")
            fail("accepted an unsafe id")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun `a corrupt index is replaced by the default workspace`() {
        val index = File(workspace.root, "workspaces.json")
        index.writeText("{not json")

        val store = store()

        assertEquals(WorkspaceStore.DEFAULT_ID, store.activeId())
        assertEquals(1, store.list().size)
    }

    @Test
    fun `list sorts default first then most recently opened`() {
        var now = 1_000L
        val store = store(clock = { now })
        val older = store.create("Older")
        now = 2_000L
        val newer = store.create("Newer")
        now = 3_000L
        store.open(older.id)

        val ids = store.list().map { it.id }

        assertEquals(WorkspaceStore.DEFAULT_ID, ids.first())
        assertEquals(listOf(older.id, newer.id), ids.drop(1))
    }
}
