package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class ScratchSweeperTest {

    private val root = createTempDir()
    private var now = 1_000_000_000L
    private val sweeper = ScratchSweeper(ttlMs = 60L * 60 * 1000) { now }

    private fun entry(name: String, ageMs: Long): File {
        val file = File(root, name)
        file.parentFile?.mkdirs()
        file.writeText("x")
        assertTrue("cannot age ${file.path}", file.setLastModified(now - ageMs))
        return file
    }

    private fun directory(name: String, ageMs: Long, children: List<String> = emptyList()): File {
        val dir = File(root, name)
        dir.mkdirs()
        for (child in children) {
            val file = File(dir, child)
            file.parentFile?.mkdirs()
            file.writeText("x")
        }
        // Set the directory's own mtime after creating the children.
        assertTrue("cannot age ${dir.path}", dir.setLastModified(now - ageMs))
        return dir
    }

    @Test
    fun `an old matching file is removed`() {
        val old = entry("restore-1.zip", ageMs = 2 * 60 * 60 * 1000)

        val removed = sweeper.sweep(root, listOf("restore-"))

        assertEquals(1, removed)
        assertFalse(old.exists())
    }

    @Test
    fun `a young matching file is kept`() {
        val young = entry("restore-2.zip", ageMs = 10 * 60 * 1000)

        val removed = sweeper.sweep(root, listOf("restore-"))

        assertEquals(0, removed)
        assertTrue(young.exists())
    }

    @Test
    fun `a matching file exactly at the ttl is removed`() {
        val edge = entry("restore-3.zip", ageMs = 60L * 60 * 1000)

        assertEquals(1, sweeper.sweep(root, listOf("restore-")))
        assertFalse(edge.exists())
    }

    @Test
    fun `non matching entries are kept`() {
        val other = entry("settings.json", ageMs = 5 * 60 * 60 * 1000)
        val suffixOnly = entry("x-restore-1.zip", ageMs = 5 * 60 * 60 * 1000)

        val removed = sweeper.sweep(root, listOf("restore-"))

        assertEquals(0, removed)
        assertTrue(other.exists())
        assertTrue(suffixOnly.exists())
    }

    @Test
    fun `an old matching directory is removed with its contents`() {
        val dir = directory(
            "import-old",
            ageMs = 3 * 60 * 60 * 1000,
            children = listOf("a.txt", "nested/b.txt")
        )

        val removed = sweeper.sweep(root, listOf("import-"))

        assertEquals(1, removed)
        assertFalse(dir.exists())
    }

    @Test
    fun `several prefixes in one directory are swept`() {
        val backup = entry("backup-1.zip", ageMs = 2 * 60 * 60 * 1000)
        val staged = directory("import-1", ageMs = 2 * 60 * 60 * 1000, children = listOf("a.txt"))
        val kept = entry("restore-1.zip", ageMs = 2 * 60 * 60 * 1000)

        val removed = sweeper.sweep(root, listOf("backup-", "import-"))

        assertEquals(2, removed)
        assertFalse(backup.exists())
        assertFalse(staged.exists())
        assertTrue(kept.exists())
    }

    @Test
    fun `a missing directory is tolerated`() {
        assertEquals(0, sweeper.sweep(File(root, "does-not-exist"), listOf("restore-")))
    }

    @Test
    fun `default rules sweep a killed restore archive and its hidden temp`() {
        val cache = File(root, "cache").apply { mkdirs() }
        val scratch = File(root, "tmp").apply { mkdirs() }
        val old = now - 2 * 60 * 60 * 1000
        val archive = File(cache, "restore-a.zip").apply { writeText("x") }
        val temp = File(scratch, ".big.txt.734eac09.tmp").apply { writeText("x") }
        val youngTemp = File(scratch, ".medium.txt.9e19e0.tmp").apply { writeText("x") }
        val unrelated = File(scratch, "notes.txt").apply { writeText("x") }
        listOf(archive, temp, unrelated).forEach { assertTrue(it.setLastModified(old)) }
        assertTrue(youngTemp.setLastModified(now - 5 * 60 * 1000))

        val removed = sweeper.sweep(ScratchSweeper.defaultRules(cache, scratch))

        assertEquals(2, removed)
        assertFalse(archive.exists())
        assertFalse(temp.exists())
        assertTrue(youngTemp.exists())
        assertTrue(unrelated.exists())
    }

    @Test
    fun `rules sweep several directories`() {
        val first = File(root, "cache").apply { mkdirs() }
        val second = File(root, "tmp").apply { mkdirs() }
        val cacheArchive = File(first, "restore-a.zip").apply { writeText("x") }
        val tmpArchive = File(second, "backup-a.zip").apply { writeText("x") }
        val tmpStaging = File(second, "import-a").apply { mkdirs() }
        val old = now - 2 * 60 * 60 * 1000
        listOf(cacheArchive, tmpArchive, tmpStaging).forEach {
            assertTrue(it.setLastModified(old))
        }

        val removed = sweeper.sweep(
            listOf(
                ScratchSweeper.Rule(first, listOf("restore-")),
                ScratchSweeper.Rule(second, listOf("backup-", "import-"))
            )
        )

        assertEquals(3, removed)
        assertFalse(cacheArchive.exists())
        assertFalse(tmpArchive.exists())
        assertFalse(tmpStaging.exists())
    }
}
