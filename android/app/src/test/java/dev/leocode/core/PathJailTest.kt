package dev.leocode.core

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeNoException
import org.junit.Test

class PathJailTest {

    private fun jail(
        workspace: File,
        shared: File? = null,
        granted: Boolean = false
    ) = PathJail(workspace, shared, { granted })

    @Test
    fun `resolves a relative path inside the workspace root`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val resolved = jail(ws).resolve("default/src/main.py")
        assertEquals(File(ws, "default/src/main.py").canonicalPath, resolved.path)
    }

    @Test
    fun `resolves an absolute path inside the workspace root`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val file = File(ws, "default/notes.txt")
        assertEquals(file.canonicalPath, jail(ws).resolve(file.absolutePath).path)
    }

    @Test(expected = SecurityException::class)
    fun `rejects parent traversal`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        jail(ws).resolve("../../secrets.env")
    }

    @Test(expected = SecurityException::class)
    fun `rejects absolute system paths`() {
        jail(createTempDir()).resolve("/system/build.prop")
    }

    @Test(expected = SecurityException::class)
    fun `rejects a sibling directory with the same textual prefix`() {
        val parent = createTempDir()
        val ws = File(parent, "workspaces").apply { mkdirs() }
        val sibling = File(parent, "workspacesX").apply { mkdirs() }
        jail(ws).resolve(File(sibling, "private.txt").absolutePath)
    }

    @Test
    fun `rejects a symlink that points outside the root`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val outside = File(createTempDir(), "secret.txt").apply { writeText("secret") }
        val link = File(ws, "escape")
        try {
            Files.createSymbolicLink(link.toPath(), outside.toPath())
        } catch (e: Exception) {
            assumeNoException("symlinks unavailable", e)
        }
        try {
            jail(ws).resolve("escape")
            throw AssertionError("symlink escape was accepted")
        } catch (_: SecurityException) {
            // expected
        }
    }

    @Test
    fun `allows a symlink that points inside the root`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val target = File(ws, "default/real.txt").apply {
            parentFile.mkdirs()
            writeText("ok")
        }
        val link = File(ws, "inside-link")
        try {
            Files.createSymbolicLink(link.toPath(), target.toPath())
        } catch (e: Exception) {
            assumeNoException("symlinks unavailable", e)
        }
        assertEquals(target.canonicalPath, jail(ws).resolve("inside-link").path)
    }

    @Test
    fun `shared storage is gated on the permission`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val shared = File(createTempDir(), "sdcard").apply { mkdirs() }
        val path = File(shared, "Download/notes.txt").absolutePath

        try {
            jail(ws, shared, granted = false).resolve(path)
            throw AssertionError("shared storage was accepted without permission")
        } catch (_: SecurityException) {
            // expected
        }

        assertEquals(
            File(shared, "Download/notes.txt").canonicalPath,
            jail(ws, shared, granted = true).resolve(path).path
        )
    }

    @Test
    fun `accepts a nonexistent file path under the root for writes`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val resolved = jail(ws).resolve("default/new/dir/file.txt")
        assertTrue(resolved.path.startsWith(ws.canonicalPath + File.separator))
    }

    @Test
    fun `accepts the root itself but rejects normalisation that leaves it`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        assertEquals(ws.canonicalPath, jail(ws).resolve(ws.absolutePath).path)

        val shared = File(createTempDir(), "sdcard").apply { mkdirs() }
        try {
            jail(ws, shared, granted = true).resolve(shared.absolutePath + "/..")
            throw AssertionError("parent of shared storage was accepted")
        } catch (_: SecurityException) {
            // expected
        }
    }

    @Test
    fun `allowed roots include the workspace and conditionally shared storage`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val shared = File(createTempDir(), "sdcard").apply { mkdirs() }

        assertEquals(listOf(ws.canonicalFile), jail(ws, shared, granted = false).allowedRoots())
        assertTrue(jail(ws, shared, granted = true).allowedRoots().contains(shared.canonicalFile))
        assertFalse(jail(ws, shared, granted = false).isAllowed(File(shared, "a.txt")))
    }

    // ------------------------------------------------------- resolveEntry (S-05)

    private fun symlink(link: File, target: File) {
        try {
            Files.createSymbolicLink(link.toPath(), target.toPath())
        } catch (e: Exception) {
            assumeNoException("symlinks unavailable", e)
        }
    }

    @Test
    fun `resolveEntry keeps the final name unresolved`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val outside = File(createTempDir(), "secret.txt").apply { writeText("secret") }
        val link = File(ws, "default/escape").apply { parentFile.mkdirs() }
        symlink(link, outside)

        val entry = jail(ws).resolveEntry("default/escape")

        assertEquals(File(File(ws, "default").canonicalPath, "escape").path, entry.path)
        assertTrue("the entry is the link itself", Files.isSymbolicLink(entry.toPath()))
        // `resolve` still follows it and refuses the outside target.
        try {
            jail(ws).resolve("default/escape")
            throw AssertionError("resolve followed the link outside the root")
        } catch (_: SecurityException) {
            // expected
        }
    }

    @Test
    fun `resolveEntry canonicalises a symlinked parent`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val realDir = File(ws, "default/real").apply { mkdirs() }
        symlink(File(ws, "default/alias"), realDir)

        val entry = jail(ws).resolveEntry("default/alias/notes.txt")

        assertEquals(File(realDir, "notes.txt").canonicalPath, entry.path)
    }

    @Test
    fun `resolveEntry rejects a parent outside the root`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        val outside = File(createTempDir(), "elsewhere").apply { mkdirs() }
        symlink(File(ws, "escape-dir"), outside)

        try {
            jail(ws).resolveEntry("escape-dir/secret.txt")
            throw AssertionError("a parent outside the root was accepted")
        } catch (_: SecurityException) {
            // expected
        }
    }

    @Test
    fun `resolveEntry rejects an entry outside the root and accepts a missing one`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }

        try {
            jail(ws).resolveEntry("/system/build.prop")
            throw AssertionError("an absolute system path was accepted")
        } catch (_: SecurityException) {
            // expected
        }

        // A rename target does not exist yet; the parent check is what matters.
        assertEquals(
            File(ws, "default/new.txt").canonicalPath,
            jail(ws).resolveEntry("default/new.txt").path
        )
    }

    @Test
    fun `resolveEntry falls back to resolve for dot paths so roots keep their identity`() {
        val ws = createTempDir().resolve("workspaces").apply { mkdirs() }
        File(ws, "default").mkdirs()

        assertEquals(ws.canonicalPath, jail(ws).resolveEntry(".").path)
        try {
            jail(ws).resolveEntry("..")
            throw AssertionError("parent of the root was accepted")
        } catch (_: SecurityException) {
            // expected
        }
    }
}
