package dev.leocode.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceJailTest {

    private fun workspace(root: File): Workspace =
        Workspace(root).also { it.ensure() }

    @Test
    fun `resolves a relative path inside the root`() {
        val root = createTempDir()
        val ws = workspace(root)
        val resolved = ws.jail(ws.defaultWorkspace, "src/main.py")
        assertTrue(resolved.path.startsWith(ws.defaultWorkspace.canonicalPath))
        assertEquals("main.py", resolved.name)
    }

    @Test(expected = SecurityException::class)
    fun `rejects parent traversal`() {
        val ws = workspace(createTempDir())
        ws.jail(ws.defaultWorkspace, "../../secrets.env")
    }

    @Test(expected = SecurityException::class)
    fun `rejects absolute path outside the root`() {
        val ws = workspace(createTempDir())
        ws.jail(ws.defaultWorkspace, "/data/data/dev.leocode/files/home")
    }

    @Test
    fun `allows an absolute path that is inside the root`() {
        val ws = workspace(createTempDir())
        val inside = File(ws.defaultWorkspace, "notes.txt")
        inside.writeText("x")
        assertEquals(inside.canonicalFile, ws.jail(ws.defaultWorkspace, inside.absolutePath))
    }

    @Test(expected = SecurityException::class)
    fun `rejects symlink escape`() {
        val ws = workspace(createTempDir())
        val outside = createTempDir()
        val link = File(ws.defaultWorkspace, "escape")
        java.nio.file.Files.createSymbolicLink(link.toPath(), outside.toPath())
        ws.jail(ws.defaultWorkspace, "escape")
    }

    private fun createTempDir(): File =
        java.nio.file.Files.createTempDirectory("leocode-test").toFile()
}
