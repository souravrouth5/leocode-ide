package dev.leocode.workspace

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchEngineTest {

    private val root = createTempDir("search")
    private val engine = SearchEngine()

    private fun file(path: String, content: String): File =
        File(root, path).also { it.parentFile?.mkdirs(); it.writeText(content) }

    @Test
    fun `finds every occurrence with line and column`() {
        file("src/a.txt", "hello world\nhello again\n")
        val matches = mutableListOf<SearchMatch>()

        val result = engine.search(root, "hello") { match -> matches.add(match) }

        assertEquals(2, result.count)
        assertFalse(result.truncated)
        assertEquals(SearchMatch("src/a.txt", 1, 1, "hello world"), matches[0])
        assertEquals(SearchMatch("src/a.txt", 2, 1, "hello again"), matches[1])
    }

    @Test
    fun `search is case-insensitive by default and can be exact`() {
        file("a.txt", "Hello hello HELLO\n")

        assertEquals(3, engine.search(root, "hello").count)
        assertEquals(1, engine.search(root, "hello", caseSensitive = true).count)
    }

    @Test
    fun `ignored directories are never entered`() {
        file("keep.txt", "needle")
        file(".git/config", "needle")
        file("node_modules/pkg/index.js", "needle")
        file(".venv/lib.py", "needle")
        file("__pycache__/x.pyc", "needle")

        val result = engine.search(root, "needle")

        assertEquals(1, result.count)
    }

    @Test
    fun `glob filters by file name or relative path`() {
        file("src/a.py", "needle")
        file("src/notes.txt", "needle")
        file("web/b.py", "needle")

        assertEquals(2, engine.search(root, "needle", glob = "*.py").count)
        assertEquals(2, engine.search(root, "needle", glob = "src/*").count)
        assertEquals(0, engine.search(root, "needle", glob = "lib/*.py").count)
    }

    @Test
    fun `binary files are skipped`() {
        file("text.txt", "needle")
        File(root, "binary.bin").writeBytes(byteArrayOf('n'.code.toByte(), 0, 'e'.code.toByte()))

        assertEquals(1, engine.search(root, "needle").count)
    }

    @Test
    fun `the result cap stops scanning and reports truncation`() {
        file("many.txt", "needle\n".repeat(20))

        val result = engine.search(root, "needle", maxResults = 5)

        assertEquals(5, result.count)
        assertTrue(result.truncated)
    }

    @Test
    fun `small files are capped and long previews trimmed`() {
        val long = "needle " + "x".repeat(300)
        file("a.txt", long)

        val matches = mutableListOf<SearchMatch>()
        engine.search(root, "needle") { matches.add(it) }

        assertEquals(1, matches.size)
        assertTrue(matches.single().preview.length <= 240)
        assertTrue(matches.single().preview.endsWith("…"))
    }

    @Test
    fun `cancellation stops the walk`() {
        repeat(50) { file("f$it.txt", "needle\n".repeat(10)) }
        var seen = 0
        val result = engine.search(
            root,
            "needle",
            isCancelled = { seen > 3 }
        ) { seen += 1 }

        assertTrue(result.count <= 5)
    }

    @Test
    fun `an empty query returns nothing`() {
        file("a.txt", "anything")

        assertEquals(0, engine.search(root, "").count)
    }
}
