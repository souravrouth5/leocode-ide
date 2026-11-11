package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.File
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
    fun `read rejects files over 2 MB`() {
        val big = File(workspace.defaultWorkspace, "big.txt")
        big.writeBytes(ByteArray(2 * 1024 * 1024 + 1) { 'a'.code.toByte() })

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
}
