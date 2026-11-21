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
    fun `a corrupt index is quarantined and its directories are recovered`() {
        val index = File(workspace.root, "workspaces.json")
        val corrupt = "{not json"
        index.writeText(corrupt)
        val recovered = File(workspace.workspacesRoot, "abc123").also { it.mkdirs() }
        File(recovered, "note.txt").writeText("hello")
        // Not a valid id, so the sweep must leave it alone.
        File(workspace.workspacesRoot, "notes space").mkdirs()

        val store = store()

        val quarantined = workspace.root.listFiles()!!
            .filter { it.name.startsWith("workspaces.json.corrupt-") }
        assertEquals(1, quarantined.size)
        assertEquals(corrupt, quarantined.single().readText())
        assertTrue(File(workspace.root, "workspaces.json").isFile)
        assertTrue(store.list().any { it.id == "abc123" && it.name == "abc123" })
        assertFalse(store.list().any { it.id == "notes space" })
        val default = store.list().first { it.id == WorkspaceStore.DEFAULT_ID }
        assertEquals(WorkspaceStore.DEFAULT_NAME, default.name)
        assertEquals(WorkspaceStore.DEFAULT_ID, store.activeId())
        assertTrue(store.directory(WorkspaceStore.DEFAULT_ID).isDirectory)
    }

    @Test
    fun `a directory missing from the index is adopted`() {
        val first = store()
        val extra = File(workspace.workspacesRoot, "extra1").also { it.mkdirs() }
        File(extra, "main.py").writeText("print(1)")

        val reloaded = store()

        val adopted = reloaded.list().firstOrNull { it.id == "extra1" }
        assertTrue("orphan directory was not adopted", adopted != null)
        assertEquals("extra1", adopted!!.name)
        assertEquals(extra.lastModified(), adopted.createdAt)
        assertTrue(reloaded.list().any { it.id == WorkspaceStore.DEFAULT_ID })
        assertTrue(first.list().none { it.id == "extra1" })
    }

    @Test
    fun `create rolls back the directory when the index cannot be written`() {
        val store = store()
        val before = store.list().map { it.id }.toSet()
        breakIndex()

        try {
            store.create("Rollback")
            fail("create succeeded with an unwritable index")
        } catch (_: IllegalStateException) {
            // expected
        }

        assertEquals(before, store.list().map { it.id }.toSet())
        assertTrue(store.list().none { it.name == "Rollback" })
        val dirs = workspace.workspacesRoot.listFiles()!!
            .filter { it.isDirectory }
            .map { it.name }
            .toSet()
        assertEquals(before, dirs)
    }

    @Test
    fun `open restores the previous active workspace when persist fails`() {
        val store = store()
        val created = store.create("Other")
        assertEquals(WorkspaceStore.DEFAULT_ID, store.activeId())
        breakIndex()

        try {
            store.open(created.id)
            fail("open succeeded with an unwritable index")
        } catch (_: IllegalStateException) {
            // expected
        }

        assertEquals(WorkspaceStore.DEFAULT_ID, store.activeId())
        assertTrue(store.directory(WorkspaceStore.DEFAULT_ID).isDirectory)
    }

    /** Makes `persist()` fail by replacing the index file with a non-empty directory. */
    private fun breakIndex() {
        val index = File(workspace.root, "workspaces.json")
        index.delete()
        index.mkdirs()
        File(index, "keep").writeText("x")
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
