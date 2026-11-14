package dev.leocode.workspace

import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class ZipBackupTest {

    private val source = createTempDir("zip-source")
    private val target = createTempDir("zip-target")
    private val backup = ZipBackup()

    private fun write(path: String, content: String): File =
        File(source, path).also { it.parentFile?.mkdirs(); it.writeText(content) }

    @Test
    fun `export and restore round-trip files and directories`() {
        write("main.py", "print('hi')")
        write("src/util.py", "x = 1")
        write("empty/.keep", "")
        val zip = File(target, "backup.zip")

        val exported = backup.export(source, zip)

        assertEquals(3, exported.files)
        assertTrue(zip.isFile)
        val restored = File(target, "restored")
        val result = backup.restore(zip, restored)

        assertEquals(exported.files, result.files)
        assertEquals("print('hi')", File(restored, "main.py").readText())
        assertEquals("x = 1", File(restored, "src/util.py").readText())
        assertTrue(File(restored, "empty").isDirectory)
    }

    @Test
    fun `progress reports running counts`() {
        write("a.txt", "a")
        write("b.txt", "bb")
        val progress = mutableListOf<Pair<Int, Long>>()

        backup.export(source, File(target, "backup.zip")) { files, bytes -> progress += files to bytes }

        assertEquals(listOf(1 to 1L, 2 to 3L), progress)
    }

    @Test
    fun `restore rejects traversal and absolute entries`() {
        val zip = File(target, "hostile.zip")
        ZipOutputStream(zip.outputStream()).use { out ->
            out.putNextEntry(ZipEntry("../escape.txt"))
            out.write("bad".toByteArray())
            out.closeEntry()
            out.putNextEntry(ZipEntry("/absolute.txt"))
            out.write("bad".toByteArray())
            out.closeEntry()
            out.putNextEntry(ZipEntry("ok.txt"))
            out.write("good".toByteArray())
            out.closeEntry()
        }
        val destination = File(target, "restored")

        val result = backup.restore(zip, destination)

        assertEquals(1, result.files)
        assertFalse(File(target, "escape.txt").exists())
        assertEquals("good", File(destination, "ok.txt").readText())
    }

    @Test
    fun `restore skips trash directories`() {
        val zip = File(target, "trash.zip")
        ZipOutputStream(zip.outputStream()).use { out ->
            out.putNextEntry(ZipEntry(".trash/old.txt"))
            out.write("old".toByteArray())
            out.closeEntry()
            out.putNextEntry(ZipEntry("keep.txt"))
            out.write("keep".toByteArray())
            out.closeEntry()
        }
        val destination = File(target, "restored")

        val result = backup.restore(zip, destination)

        assertEquals(1, result.files)
        assertFalse(File(destination, ".trash/old.txt").exists())
    }

    @Test
    fun `restore enforces the entry size limit`() {
        val zip = File(target, "big.zip")
        ZipOutputStream(zip.outputStream()).use { out ->
            out.putNextEntry(ZipEntry("big.txt"))
            out.write(ByteArray(1024))
            out.closeEntry()
        }
        val small = ZipBackup(maxEntryBytes = 10)

        try {
            small.restore(zip, File(target, "restored"))
            fail("oversized entry was restored")
        } catch (e: java.io.IOException) {
            assertTrue(e.message!!.contains("limit"))
        }
    }

    @Test
    fun `restore enforces the file count limit`() {
        val zip = File(target, "many.zip")
        ZipOutputStream(zip.outputStream()).use { out ->
            for (index in 0 until 3) {
                out.putNextEntry(ZipEntry("f$index.txt"))
                out.write(1)
                out.closeEntry()
            }
        }
        val small = ZipBackup(maxFiles = 2)

        try {
            small.restore(zip, File(target, "restored"))
            fail("file limit was ignored")
        } catch (e: java.io.IOException) {
            assertTrue(e.message!!.contains("too many"))
        }
    }

    @Test
    fun `export ignores the workspace trash`() {
        write("keep.txt", "keep")
        write(".leocode-trash/old.txt", "old")

        val result = backup.export(source, File(target, "backup.zip"))

        assertEquals(1, result.files)
    }

    @Test
    fun `restore overwrites an existing file atomically`() {
        write("a.txt", "new")
        val zip = File(target, "backup.zip")
        backup.export(source, zip)
        val destination = File(target, "restored")
        File(destination, "a.txt").also { it.parentFile.mkdirs(); it.writeText("old") }

        backup.restore(zip, destination)

        assertEquals("new", File(destination, "a.txt").readText())
    }
}
