package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

class ImportStagingTest {

    private val root = createTempDir()
    private val scratch = File(root, "tmp")
    private val workspace = File(root, "workspaces/default").apply { mkdirs() }

    // ------------------------------------------------------------- staging

    @Test
    fun `staging creates a fresh empty directory under the scratch root`() {
        val first = ImportStaging.createStaging(scratch)
        val second = ImportStaging.createStaging(scratch)

        assertTrue(first.isDirectory)
        assertTrue(second.isDirectory)
        assertEquals(emptyList<File>(), first.listFiles()!!.toList())
        assertTrue(first.name.startsWith("import-"))
        assertFalse(first == second)
    }

    @Test
    fun `staging creates the scratch root when it is missing`() {
        val nested = File(root, "missing/tmp")

        val staging = ImportStaging.createStaging(nested)

        assertTrue(staging.isDirectory)
        assertTrue(nested.isDirectory)
    }

    // ------------------------------------------------------------- move tree

    @Test
    fun `the staged tree is moved to the requested name`() {
        val staged = ImportStaging.createStaging(scratch)
        File(staged, "notes.txt").writeText("hello")
        File(staged, "src").mkdirs()
        File(staged, "src/main.py").writeText("print(1)")

        val target = ImportStaging.moveIntoWorkspace(staged, workspace, "project")

        assertEquals(File(workspace, "project"), target)
        assertEquals("hello", File(target, "notes.txt").readText())
        assertEquals("print(1)", File(target, "src/main.py").readText())
        assertFalse("staging is gone after the move", staged.exists())
    }

    @Test
    fun `an existing name gets the next free suffix`() {
        File(workspace, "project").mkdirs()
        File(workspace, "project-2").mkdirs()
        val staged = ImportStaging.createStaging(scratch)
        File(staged, "notes.txt").writeText("new")

        val target = ImportStaging.moveIntoWorkspace(staged, workspace, "project")

        assertEquals("project-3", target.name)
        assertEquals("new", File(target, "notes.txt").readText())
        assertEquals(
            "the existing folder is untouched",
            emptyList<File>(),
            File(workspace, "project").listFiles()!!.toList()
        )
    }

    // ---------------------------------------------------------- move children

    @Test
    fun `children are moved into an existing destination without overwriting`() {
        val dest = File(workspace, "chosen").apply { mkdirs() }
        File(dest, "notes.txt").writeText("old")
        File(dest, "readme.md").writeText("old readme")
        val staged = ImportStaging.createStaging(scratch)
        File(staged, "notes.txt").writeText("new")
        File(staged, "readme").mkdirs()
        File(staged, "readme/deep.txt").writeText("deep")
        File(staged, "src").mkdirs()
        File(staged, "src/main.py").writeText("print(1)")

        val moved = ImportStaging.moveChildren(staged, dest)

        assertEquals(3, moved.size)
        assertEquals("old", File(dest, "notes.txt").readText())
        assertEquals("new", File(dest, "notes-2.txt").readText())
        assertEquals("old readme", File(dest, "readme.md").readText())
        assertEquals("deep", File(dest, "readme/deep.txt").readText())
        assertEquals("print(1)", File(dest, "src/main.py").readText())
        assertEquals("staging is empty", 0, staged.listFiles()!!.size)
    }

    @Test
    fun `a file name keeps its extension when a suffix is needed`() {
        val dest = File(workspace, "chosen").apply { mkdirs() }
        File(dest, "report.tar.gz").writeText("old")
        val staged = ImportStaging.createStaging(scratch)
        File(staged, "report.tar.gz").writeText("new")

        ImportStaging.moveChildren(staged, dest)

        assertEquals("new", File(dest, "report.tar-2.gz").readText())
    }

    @Test
    fun `moving an empty staging tree leaves the destination alone`() {
        val dest = File(workspace, "chosen").apply { mkdirs() }
        val staged = ImportStaging.createStaging(scratch)

        assertEquals(emptyList<File>(), ImportStaging.moveChildren(staged, dest))
        assertEquals(0, dest.listFiles()!!.size)
        assertTrue(staged.exists())
    }

    @Test
    fun `available names do not collide with names claimed in the same batch`() {
        val parent = File(root, "names").apply { mkdirs() }
        val claimed = HashSet<String>()

        assertEquals("a.txt", ImportStaging.availableName(parent, "a.txt", false, claimed))
        assertEquals("a-2.txt", ImportStaging.availableName(parent, "a.txt", false, claimed))
        assertEquals("dir", ImportStaging.availableName(parent, "dir", true, claimed))
        assertEquals("dir-2", ImportStaging.availableName(parent, "dir", true, claimed))
    }

    // -------------------------------------------------------------- cleanup

    @Test
    fun `delete removes a nested tree and tolerates a missing entry`() {
        val staged = ImportStaging.createStaging(scratch)
        File(staged, "a/b").mkdirs()
        File(staged, "a/b/c.txt").writeText("x")
        File(staged, "top.txt").writeText("y")

        assertTrue(ImportStaging.deleteRecursively(staged))
        assertFalse(staged.exists())

        assertTrue(ImportStaging.deleteRecursively(staged))
        assertTrue(ImportStaging.deleteRecursively(File(root, "never-existed")))
    }

    // --------------------------------------------------------------- budget

    @Test
    fun `the file cap throws the shared limit message`() {
        val budget = ImportBudget(maxFiles = 2)
        budget.addFile()
        budget.addFile()

        val error = try {
            budget.addFile()
            fail("expected the file cap to throw")
            null
        } catch (e: IllegalStateException) {
            e
        }

        assertNotNull(error)
        assertEquals(ImportStaging.LIMIT_MESSAGE, error!!.message)
        assertEquals(3, budget.files)
    }

    @Test
    fun `the byte cap throws the shared limit message`() {
        val budget = ImportBudget(maxBytes = 10)
        budget.addBytes(10)

        val error = try {
            budget.addBytes(1)
            fail("expected the byte cap to throw")
            null
        } catch (e: IllegalStateException) {
            e
        }

        assertNotNull(error)
        assertEquals(ImportStaging.LIMIT_MESSAGE, error!!.message)
        assertEquals(11L, budget.bytes)
    }

    @Test
    fun `depth up to 64 is accepted and 65 throws`() {
        val budget = ImportBudget()
        budget.checkDepth(0)
        budget.checkDepth(ImportStaging.MAX_DEPTH)

        val error = try {
            budget.checkDepth(ImportStaging.MAX_DEPTH + 1)
            fail("expected the depth check to throw")
            null
        } catch (e: IllegalStateException) {
            e
        }

        assertNotNull(error)
        assertEquals(ImportStaging.DEPTH_MESSAGE, error!!.message)
    }
}
