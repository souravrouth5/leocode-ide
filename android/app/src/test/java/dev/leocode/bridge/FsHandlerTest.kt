package dev.leocode.bridge

import dev.leocode.core.FileHash
import dev.leocode.core.PathJail
import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.LinkOption
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeNoException
import org.junit.Assume.assumeTrue
import org.junit.Test

class FsHandlerTest {

    private val root = createTempDir()
    private val workspace = Workspace(root).also { it.ensure() }
    private val jail = PathJail(workspace.workspacesRoot, null) { false }
    private val trash = Trash(File(workspace.root, ".trash"))
    private val json = Json { ignoreUnknownKeys = true }
    private val handler = FsHandler(workspace, jail, trash, json)

    private fun write(path: String, content: String): JsonObject =
        handler.handle(
            "fs.write",
            buildJsonObject {
                put("path", path)
                put("content", content)
            }
        ).jsonObject

    private fun read(path: String): JsonObject =
        handler.handle("fs.read", buildJsonObject { put("path", path) }).jsonObject

    private fun list(path: String = "."): JsonArray =
        handler.handle("fs.list", buildJsonObject { put("path", path) }) as JsonArray

    private fun call(method: String, payload: JsonObject) = handler.handle(method, payload)

    private fun expect(code: ErrorCode, block: () -> Unit) {
        try {
            block()
            fail("expected $code")
        } catch (e: BridgeException) {
            assertEquals(code, e.errorCode)
        }
    }

    @Test
    fun `writes reads and lists keep the existing JSON shape`() {
        val written = write("notes.txt", "hello")

        assertEquals("notes.txt", written["path"]!!.jsonPrimitive.content)
        assertEquals(5, written["size"]!!.jsonPrimitive.content.toInt())

        val read = read("notes.txt")
        assertEquals("notes.txt", read["path"]!!.jsonPrimitive.content)
        assertEquals("hello", read["content"]!!.jsonPrimitive.content)
        assertEquals(5, read["size"]!!.jsonPrimitive.content.toInt())

        val names = list().map { it.jsonObject["name"]!!.jsonPrimitive.content }
        assertTrue(names.contains("notes.txt"))
    }

    @Test
    fun `write creates missing parent directories`() {
        val written = write("src/deep/main.py", "print(1)")

        assertEquals("src/deep/main.py", written["path"]!!.jsonPrimitive.content)
        assertEquals("print(1)", read("src/deep/main.py")["content"]!!.jsonPrimitive.content)
    }

    @Test
    fun `mkdir and rename work inside the workspace`() {
        call("fs.mkdir", buildJsonObject { put("path", "src") })
        assertTrue(File(workspace.defaultWorkspace, "src").isDirectory)

        write("src/a.txt", "a")
        val renamed = call(
            "fs.rename",
            buildJsonObject {
                put("from", "src/a.txt")
                put("to", "src/b.txt")
            }
        ).jsonObject

        assertEquals("src/b.txt", renamed["to"]!!.jsonPrimitive.content)
        assertFalse(File(workspace.defaultWorkspace, "src/a.txt").exists())
        assertEquals("a", read("src/b.txt")["content"]!!.jsonPrimitive.content)
    }

    @Test
    fun `rename refuses to overwrite an existing target`() {
        write("a.txt", "a")
        write("b.txt", "b")

        expect(ErrorCode.E_EXISTS) {
            call(
                "fs.rename",
                buildJsonObject {
                    put("from", "a.txt")
                    put("to", "b.txt")
                }
            )
        }
    }

    @Test
    fun `traversal and system paths are rejected`() {
        expect(ErrorCode.E_PATH_OUTSIDE_ROOT) { read("../../outside.txt") }
        expect(ErrorCode.E_PATH_OUTSIDE_ROOT) { read("/system/build.prop") }
        expect(ErrorCode.E_PATH_OUTSIDE_ROOT) { list("/sdcard/..") }
    }

    @Test
    fun `sibling directory with a workspace prefix is rejected`() {
        val parent = createTempDir()
        val other = Workspace(parent).also { it.ensure() }
        val sibling = File(parent, "workspacesX").apply { mkdirs() }
        File(sibling, "note.txt").writeText("secret")

        val otherJail = PathJail(other.workspacesRoot, null) { false }
        val otherHandler = FsHandler(other, otherJail, Trash(File(other.root, ".trash")), json)

        try {
            otherHandler.handle(
                "fs.read",
                buildJsonObject { put("path", File(sibling, "note.txt").absolutePath) }
            )
            fail("sibling path was accepted")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_PATH_OUTSIDE_ROOT, e.errorCode)
        }
    }

    @Test
    fun `read rejects files over 4 MB`() {
        val big = File(workspace.defaultWorkspace, "big.txt")
        big.writeBytes(ByteArray(4 * 1024 * 1024 + 1) { 'a'.code.toByte() })

        expect(ErrorCode.E_LIMIT) { read("big.txt") }
    }

    @Test
    fun `write rejects content over 4 MB and leaves no file`() {
        val content = "a".repeat(4 * 1024 * 1024 + 1)

        expect(ErrorCode.E_LIMIT) { write("huge.txt", content) }
        assertFalse(File(workspace.defaultWorkspace, "huge.txt").exists())
    }

    @Test
    fun `read rejects binary files`() {
        File(workspace.defaultWorkspace, "bin.dat").writeBytes(byteArrayOf(1, 2, 0, 3))

        expect(ErrorCode.E_BINARY) { read("bin.dat") }
    }

    @Test
    fun `list distinguishes a missing path from a file`() {
        expect(ErrorCode.E_NOT_FOUND) { list("missing") }

        write("file.txt", "x")
        expect(ErrorCode.E_NOT_DIR) { list("file.txt") }
    }

    @Test
    fun `delete moves the entry to the trash`() {
        write("gone.txt", "x")

        val reply = call("fs.delete", buildJsonObject { put("path", "gone.txt") }).jsonObject

        assertEquals("gone.txt", reply["deleted"]!!.jsonPrimitive.content)
        assertFalse(File(workspace.defaultWorkspace, "gone.txt").exists())
        assertEquals(1, File(workspace.root, ".trash").listFiles()?.size)
    }

    @Test
    fun `delete refuses to trash the workspace root`() {
        expect(ErrorCode.E_PERMISSION) {
            call("fs.delete", buildJsonObject { put("path", ".") })
        }
    }

    @Test
    fun `list hides both trash directories`() {
        File(workspace.defaultWorkspace, ".trash").mkdirs()
        File(workspace.defaultWorkspace, ".leocode-trash").mkdirs()
        File(workspace.defaultWorkspace, "visible.txt").writeText("v")

        val names = list().map { it.jsonObject["name"]!!.jsonPrimitive.content }

        assertTrue(names.contains("visible.txt"))
        assertFalse(names.contains(".trash"))
        assertFalse(names.contains(".leocode-trash"))
    }

    @Test
    fun `deleting or renaming the workspace root is refused`() {
        expect(ErrorCode.E_PERMISSION) {
            call("fs.delete", buildJsonObject { put("path", ".") })
        }
        expect(ErrorCode.E_PERMISSION) {
            call(
                "fs.rename",
                buildJsonObject {
                    put("from", ".")
                    put("to", "renamed")
                }
            )
        }
    }

    @Test
    fun `deleting the trash directory is refused`() {
        val localTrash = Trash(File(workspace.defaultWorkspace, ".trash")).also {
            it.directories().forEach { dir -> dir.mkdirs() }
        }
        val localHandler = FsHandler(workspace, jail, localTrash, json)
        try {
            localHandler.handle("fs.delete", buildJsonObject { put("path", ".trash") })
            fail("expected E_PERMISSION")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_PERMISSION, e.errorCode)
        }
    }

    // ------------------------------------------------- S-03: non-regular files

    /** Creates a FIFO with `mkfifo`; skips the test when the platform has none. */
    private fun makeFifo(file: File) {
        val process = try {
            ProcessBuilder("mkfifo", file.absolutePath).redirectErrorStream(true).start()
        } catch (e: IOException) {
            assumeNoException("mkfifo is unavailable", e)
            return
        }
        val output = process.inputStream.bufferedReader().readText()
        process.waitFor()
        assumeTrue("mkfifo failed: $output", process.exitValue() == 0 && file.exists())
    }

    @Test(timeout = 15_000)
    fun `read rejects a FIFO instead of blocking the bridge thread`() {
        makeFifo(File(workspace.defaultWorkspace, "pipe"))

        // Without the regular-file check `readBytes()` never returns here.
        expect(ErrorCode.E_NOT_DIR) { read("pipe") }
    }

    @Test(timeout = 15_000)
    fun `read rejects a FIFO even though its length is zero`() {
        val fifo = File(workspace.defaultWorkspace, "pipe2")
        makeFifo(fifo)
        assertEquals(0L, fifo.length())

        expect(ErrorCode.E_NOT_DIR) { read("pipe2") }
    }

    // ------------------------------------------------------- S-09: read limits

    @Test
    fun `read accepts a file between 2 and 4 MB`() {
        val size = 3 * 1024 * 1024
        File(workspace.defaultWorkspace, "three.txt")
            .writeBytes(ByteArray(size) { 'a'.code.toByte() })

        val reply = read("three.txt")

        assertEquals(size, reply["size"]!!.jsonPrimitive.content.toInt())
        assertEquals(size, reply["content"]!!.jsonPrimitive.content.length)
    }

    @Test
    fun `read accepts a file of exactly the write cap`() {
        val cap = 4 * 1024 * 1024
        File(workspace.defaultWorkspace, "cap.txt")
            .writeBytes(ByteArray(cap) { 'a'.code.toByte() })

        assertEquals(cap, read("cap.txt")["size"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `everything fs write accepts fs read can open`() {
        // The point of S-09: a big write must not produce an unreadable file.
        val content = "a".repeat(3 * 1024 * 1024)
        write("big.txt", content)

        assertEquals(content.length, read("big.txt")["content"]!!.jsonPrimitive.content.length)
    }

    // ------------------------------------------------------- S-08: strict UTF-8

    @Test
    fun `read rejects invalid UTF-8 instead of replacing it`() {
        // "café" written as Latin-1: 0xE9 is not a valid UTF-8 sequence.
        File(workspace.defaultWorkspace, "latin1.txt")
            .writeBytes(byteArrayOf(0x63, 0x61, 0x66, 0xE9.toByte(), 0x0A))

        expect(ErrorCode.E_BINARY) { read("latin1.txt") }
    }

    @Test
    fun `read rejects a truncated multi-byte sequence`() {
        // First two bytes of U+20AC (E2 82 AC), cut short.
        File(workspace.defaultWorkspace, "cut.txt")
            .writeBytes(byteArrayOf(0xE2.toByte(), 0x82.toByte()))

        expect(ErrorCode.E_BINARY) { read("cut.txt") }
    }

    @Test
    fun `read decodes multi-byte UTF-8 and keeps the BOM`() {
        val text = "\uFEFFh\u00e9llo w\u00f6rld \u2713\n"
        File(workspace.defaultWorkspace, "utf8.txt").writeBytes(text.toByteArray(Charsets.UTF_8))

        val reply = read("utf8.txt")

        assertEquals(text, reply["content"]!!.jsonPrimitive.content)
        // The BOM still round-trips through a save unchanged.
        write("utf8.txt", reply["content"]!!.jsonPrimitive.content)
        assertEquals(text, File(workspace.defaultWorkspace, "utf8.txt").readText())
    }

    @Test
    fun `read still reports NUL bytes as binary`() {
        File(workspace.defaultWorkspace, "nul.txt").writeBytes(byteArrayOf(0x61, 0x00, 0x62))

        expect(ErrorCode.E_BINARY) { read("nul.txt") }
    }

    // ---------------------------------------------------------- S-04: rel()

    @Test
    fun `paths stay relative when the workspace is reached through a symlink`() {
        // Mirrors the device: filesDir is /data/user/0/... but canonicalises to
        // /data/data/... (S-04). The alias plays the role of /data/user/0.
        val real = createTempDir()
        val alias = File(createTempDir(), "alias")
        try {
            Files.createSymbolicLink(alias.toPath(), real.toPath())
        } catch (e: Exception) {
            assumeNoException("symlinks unavailable", e)
            return
        }
        val aliased = Workspace(alias).also { it.ensure() }
        val aliasedHandler = FsHandler(
            aliased,
            PathJail(aliased.workspacesRoot, null) { false },
            Trash(File(aliased.root, ".trash")),
            json
        )

        val written = aliasedHandler.handle(
            "fs.write",
            buildJsonObject {
                put("path", "notes.txt")
                put("content", "hello")
            }
        ).jsonObject
        val readBack = aliasedHandler.handle(
            "fs.read",
            buildJsonObject { put("path", "notes.txt") }
        ).jsonObject
        val listed = aliasedHandler.handle(
            "fs.list",
            buildJsonObject { put("path", ".") }
        ) as JsonArray

        assertEquals("notes.txt", written["path"]!!.jsonPrimitive.content)
        assertEquals("notes.txt", readBack["path"]!!.jsonPrimitive.content)
        assertEquals("notes.txt", listed.single().jsonObject["path"]!!.jsonPrimitive.content)
    }

    // ------------------------------------------------------- S-05: symlinks

    private fun symlink(link: File, target: File) {
        try {
            Files.createSymbolicLink(link.toPath(), target.toPath())
        } catch (e: Exception) {
            assumeNoException("symlinks unavailable", e)
        }
    }

    private fun linkExists(file: File): Boolean =
        Files.exists(file.toPath(), LinkOption.NOFOLLOW_LINKS)

    @Test
    fun `deleting a workspace symlink removes the link and leaves the target`() {
        val target = File(workspace.defaultWorkspace, "real.txt").apply { writeText("keep") }
        val link = File(workspace.defaultWorkspace, "link.txt")
        symlink(link, target)

        val reply = call("fs.delete", buildJsonObject { put("path", "link.txt") }).jsonObject

        assertEquals("link.txt", reply["deleted"]!!.jsonPrimitive.content)
        assertFalse("the link is gone", linkExists(link))
        assertTrue("the target is untouched", target.exists())
        assertEquals("keep", target.readText())

        // The trash holds the link, not a copy of the target.
        val trashed = File(workspace.root, ".trash").listFiles()!!.single()
        assertTrue(Files.isSymbolicLink(trashed.toPath()))
    }

    @Test
    fun `a symlink pointing outside the jail can be deleted`() {
        val outside = File(createTempDir(), "secret.txt").apply { writeText("secret") }
        val link = File(workspace.defaultWorkspace, "escape")
        symlink(link, outside)

        // The target stays outside the jail, so `fs.read` must refuse it...
        expect(ErrorCode.E_PATH_OUTSIDE_ROOT) { read("escape") }

        // ...while the link itself can still be removed (it was impossible before S-05).
        val reply = call("fs.delete", buildJsonObject { put("path", "escape") }).jsonObject

        assertEquals("escape", reply["deleted"]!!.jsonPrimitive.content)
        assertFalse(linkExists(link))
        assertTrue(outside.exists())
        assertEquals("secret", outside.readText())
    }

    @Test
    fun `deleting a dangling symlink works`() {
        val link = File(workspace.defaultWorkspace, "dangling")
        symlink(link, File(createTempDir(), "gone.txt"))

        call("fs.delete", buildJsonObject { put("path", "dangling") })

        assertFalse(linkExists(link))
    }

    @Test
    fun `renaming a symlink renames the link and not the target`() {
        val target = File(workspace.defaultWorkspace, "real.txt").apply { writeText("keep") }
        val link = File(workspace.defaultWorkspace, "link.txt")
        symlink(link, target)

        val reply = call(
            "fs.rename",
            buildJsonObject {
                put("from", "link.txt")
                put("to", "moved.txt")
            }
        ).jsonObject

        assertEquals("moved.txt", reply["to"]!!.jsonPrimitive.content)
        assertFalse(linkExists(link))
        val moved = File(workspace.defaultWorkspace, "moved.txt")
        assertTrue("the entry is still a link", Files.isSymbolicLink(moved.toPath()))
        assertTrue("the target kept its name", target.exists())
        assertEquals("keep", target.readText())
    }

    @Test
    fun `renaming a directory reached through a symlinked parent uses the real entry`() {
        val realDir = File(workspace.defaultWorkspace, "real").apply { mkdirs() }
        val file = File(realDir, "a.txt").apply { writeText("a") }
        val linkDir = File(workspace.defaultWorkspace, "aliasdir")
        symlink(linkDir, realDir)

        call(
            "fs.rename",
            buildJsonObject {
                put("from", "aliasdir/a.txt")
                put("to", "aliasdir/b.txt")
            }
        )

        assertFalse(file.exists())
        assertEquals("a", File(realDir, "b.txt").readText())
    }

    @Test
    fun `a symlinked parent pointing outside the jail is rejected`() {
        val outsideDir = createTempDir()
        val linkDir = File(workspace.defaultWorkspace, "outside-dir")
        symlink(linkDir, outsideDir)
        File(outsideDir, "secret.txt").writeText("secret")

        expect(ErrorCode.E_PATH_OUTSIDE_ROOT) { read("outside-dir/secret.txt") }
        expect(ErrorCode.E_PATH_OUTSIDE_ROOT) {
            call("fs.delete", buildJsonObject { put("path", "outside-dir/secret.txt") })
        }
    }

    // --------------------------------------------- S-12: same-inode rename

    @Test
    fun `rename allows a target that resolves to the same file`() {
        // A hard link is the portable stand-in for "two names, one inode", which
        // is what a case-only rename looks like on case-insensitive storage.
        val source = File(workspace.defaultWorkspace, "keep.txt").apply { writeText("same") }
        val alias = File(workspace.defaultWorkspace, "alias.txt")
        try {
            Files.createLink(alias.toPath(), source.toPath())
        } catch (e: Exception) {
            assumeNoException("hard links unavailable", e)
            return
        }

        // Before S-12 this was E_EXISTS because `to` existed.
        val reply = call(
            "fs.rename",
            buildJsonObject {
                put("from", "keep.txt")
                put("to", "alias.txt")
            }
        ).jsonObject

        assertEquals("alias.txt", reply["to"]!!.jsonPrimitive.content)
        assertEquals("same", File(workspace.defaultWorkspace, "alias.txt").readText())
    }

    @Test
    fun `rename to the same path is a no-op success`() {
        write("same.txt", "x")

        val reply = call(
            "fs.rename",
            buildJsonObject {
                put("from", "same.txt")
                put("to", "same.txt")
            }
        ).jsonObject

        assertEquals("same.txt", reply["to"]!!.jsonPrimitive.content)
        assertEquals("x", read("same.txt")["content"]!!.jsonPrimitive.content)
    }

    @Test
    fun `rename still refuses a different existing target`() {
        write("a.txt", "a")
        write("b.txt", "b")

        expect(ErrorCode.E_EXISTS) {
            call(
                "fs.rename",
                buildJsonObject {
                    put("from", "a.txt")
                    put("to", "b.txt")
                }
            )
        }
        assertEquals("b", read("b.txt")["content"]!!.jsonPrimitive.content)
        assertEquals("a", read("a.txt")["content"]!!.jsonPrimitive.content)
    }

    // --------------------------------------------------- PD-12: stat hash cache

    private class CountingHash {
        var calls = 0

        fun hash(file: File): String? {
            calls += 1
            return FileHash.safeHash(file)
        }
    }

    private fun countingHandler(counting: CountingHash, maxEntries: Int = 64): FsHandler =
        FsHandler(
            workspace,
            jail,
            trash,
            json,
            hashFile = counting::hash,
            maxStatHashes = maxEntries
        )

    private fun statOf(path: String, on: FsHandler = handler): JsonObject =
        on.handle("fs.stat", buildJsonObject { put("path", path) }).jsonObject

    @Test
    fun `stat reuses the hash while size and mtime are unchanged`() {
        File(workspace.defaultWorkspace, "stable.txt").writeText("hello")
        val counting = CountingHash()
        val countingHandler = countingHandler(counting)

        val first = statOf("stable.txt", countingHandler)
        val second = statOf("stable.txt", countingHandler)

        assertEquals(1, counting.calls)
        assertEquals(first["hash"], second["hash"])
        assertEquals(FileHash.sha256("hello"), first["hash"]!!.jsonPrimitive.content)
        assertEquals(FileHash.sha256("hello"), second["hash"]!!.jsonPrimitive.content)
        assertEquals(5, second["size"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `a size change hashes the file again`() {
        val file = File(workspace.defaultWorkspace, "growing.txt").apply { writeText("one") }
        val counting = CountingHash()
        val countingHandler = countingHandler(counting)

        statOf("growing.txt", countingHandler)
        file.writeText("one and two")
        val reply = statOf("growing.txt", countingHandler)

        assertEquals(2, counting.calls)
        assertEquals(FileHash.sha256("one and two"), reply["hash"]!!.jsonPrimitive.content)
    }

    @Test
    fun `an mtime change hashes the file again`() {
        val file = File(workspace.defaultWorkspace, "touched.txt").apply { writeText("same") }
        val counting = CountingHash()
        val countingHandler = countingHandler(counting)

        val before = statOf("touched.txt", countingHandler)
        assertTrue("cannot change the mtime", file.setLastModified(file.lastModified() + 5_000))
        val after = statOf("touched.txt", countingHandler)

        assertEquals(2, counting.calls)
        assertEquals(before["hash"], after["hash"])
        assertEquals(FileHash.sha256("same"), after["hash"]!!.jsonPrimitive.content)
    }

    @Test
    fun `a write clears the cached hash`() {
        val counting = CountingHash()
        val countingHandler = countingHandler(counting)
        countingHandler.handle(
            "fs.write",
            buildJsonObject {
                put("path", "saved.txt")
                put("content", "first")
            }
        )
        statOf("saved.txt", countingHandler)

        countingHandler.handle(
            "fs.write",
            buildJsonObject {
                put("path", "saved.txt")
                put("content", "second")
            }
        )
        counting.calls = 0
        val reply = statOf("saved.txt", countingHandler)

        assertEquals(1, counting.calls)
        assertEquals(FileHash.sha256("second"), reply["hash"]!!.jsonPrimitive.content)
    }

    @Test
    fun `directory stats do not hash`() {
        val counting = CountingHash()
        val countingHandler = countingHandler(counting)
        countingHandler.handle("fs.mkdir", buildJsonObject { put("path", "src") })

        val reply = statOf("src", countingHandler)

        assertEquals(0, counting.calls)
        assertEquals("dir", reply["kind"]!!.jsonPrimitive.content)
        assertEquals("", reply["hash"]!!.jsonPrimitive.content)
        assertEquals(0, reply["size"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun `the stat hash cache is bounded`() {
        listOf("a.txt", "b.txt", "c.txt").forEach {
            File(workspace.defaultWorkspace, it).writeText(it)
        }
        val counting = CountingHash()
        val countingHandler = countingHandler(counting, maxEntries = 2)

        statOf("a.txt", countingHandler)
        statOf("b.txt", countingHandler)
        statOf("c.txt", countingHandler)
        assertEquals(3, counting.calls)

        // a was evicted by c, so it is hashed again and b becomes the oldest.
        statOf("a.txt", countingHandler)
        assertEquals(4, counting.calls)
        statOf("c.txt", countingHandler)
        assertEquals("a hit does not hash", 4, counting.calls)
        statOf("b.txt", countingHandler)
        assertEquals(5, counting.calls)
    }
}
