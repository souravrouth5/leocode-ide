package dev.leocode.core

import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TrashTest {

    @Test
    fun `moves a file and a directory into the workspace trash`() {
        val root = createTempDir()
        val trash = Trash(File(root, ".trash"))
        val file = File(root, "a.txt").apply { writeText("a") }
        val dir = File(root, "project").apply { mkdirs() }
        File(dir, "main.py").writeText("print(1)")

        val trashedFile = trash.move(file)
        val trashedDir = trash.move(dir)

        assertFalse(file.exists())
        assertFalse(dir.exists())
        assertTrue(trashedFile.isFile)
        assertTrue(File(trashedDir, "main.py").isFile)
    }

    @Test
    fun `the same filename moved twice yields distinct entries`() {
        val root = createTempDir()
        val trash = Trash(File(root, ".trash"))

        val first = File(root, "same.txt").apply { writeText("1") }
        val a = trash.move(first)
        val second = File(root, "same.txt").apply { writeText("2") }
        val b = trash.move(second)

        assertNotEquals(a.path, b.path)
        assertTrue(a.isFile)
        assertTrue(b.isFile)
    }

    @Test
    fun `a target under the shared root goes to the shared trash`() {
        val root = createTempDir()
        val sharedRoot = File(createTempDir(), "sdcard").apply { mkdirs() }
        val sharedTrash = File(sharedRoot, ".leocode-trash")
        val trash = Trash(File(root, ".trash"), sharedTrash)
        val target = File(sharedRoot, "Download/note.txt").apply {
            parentFile.mkdirs()
            writeText("shared")
        }

        val trashed = trash.move(target, sharedRoot)

        assertTrue(trashed.path.startsWith(sharedTrash.canonicalPath + File.separator))
        assertFalse(target.exists())
    }

    @Test
    fun `missing shared trash falls back to the workspace trash`() {
        val root = createTempDir()
        val sharedRoot = File(createTempDir(), "sdcard").apply { mkdirs() }
        val trash = Trash(File(root, ".trash"), sharedTrash = null)
        val target = File(sharedRoot, "note.txt").apply { writeText("shared") }

        val trashed = trash.move(target, sharedRoot)

        assertTrue(trashed.path.startsWith(File(root, ".trash").canonicalPath + File.separator))
    }

    @Test
    fun `purge removes entries older than 30 days and keeps fresh ones`() {
        val root = createTempDir()
        val trashDir = File(root, ".trash").apply { mkdirs() }
        val trash = Trash(trashDir)
        val now = 1_700_000_000_000L
        val old = File(trashDir, "old.txt").apply {
            writeText("old")
            setLastModified(now - 31L * 24 * 60 * 60 * 1000)
        }
        val fresh = File(trashDir, "fresh.txt").apply {
            writeText("fresh")
            setLastModified(now - 1L * 24 * 60 * 60 * 1000)
        }

        assertEquals(1, trash.purge(now = now))
        assertFalse(old.exists())
        assertTrue(fresh.exists())
    }

    @Test
    fun `an old file deleted now is not purged by the next delete`() {
        val root = createTempDir()
        val trash = Trash(File(root, ".trash"))
        val now = 1_700_000_000_000L
        val old = File(root, "notes.txt").apply {
            writeText("old")
            setLastModified(now - 45L * 24 * 60 * 60 * 1000)
        }

        val trashed = trash.move(old, now = now)
        // A minute later: the file was trashed "now", so it is still inside the
        // 30-day window even though its mtime is 45 days old (S-01).
        assertEquals(0, trash.purge(now = now + 60_000L))
        assertTrue(trashed.exists())

        // After the window, the embedded trash time expires it as intended.
        assertEquals(1, trash.purge(now = now + 31L * 24 * 60 * 60 * 1000))
        assertFalse(trashed.exists())
    }

    @Test(expected = IOException::class)
    fun `refuses to move the trash directory itself`() {
        val root = createTempDir()
        val trashDir = File(root, ".trash").apply { mkdirs() }
        Trash(trashDir).move(trashDir)
    }

    @Test(expected = IOException::class)
    fun `moving a nonexistent target throws and creates no trash entry`() {
        val root = createTempDir()
        val trashDir = File(root, ".trash")
        val trash = Trash(trashDir)
        try {
            trash.move(File(root, "missing.txt"))
        } finally {
            assertTrue(trashDir.listFiles().isNullOrEmpty())
        }
    }
}
