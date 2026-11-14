package dev.leocode.bridge

import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import dev.leocode.workspace.Drafts
import dev.leocode.workspace.WorkspaceStore
import java.io.File
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

class WorkspaceHandlerTest {

    private val root = createTempDir("workspace-handler")
    private val workspace = Workspace(root).also { it.ensure() }
    private val store = WorkspaceStore(
        workspace,
        Trash(File(workspace.root, ".trash"))
    ).also { it.ensure() }
    private val handler = WorkspaceHandler(store)

    private fun call(method: String, payload: JsonObject = JsonObject(emptyMap())) =
        handler.handle(method, payload)

    private fun expect(code: ErrorCode, block: () -> Unit) {
        try {
            block()
            fail("expected $code")
        } catch (e: BridgeException) {
            assertEquals(code, e.errorCode)
        }
    }

    @Test
    fun `list exposes the active workspace and its path`() {
        val reply = call("workspace.list").jsonObject
        assertEquals(WorkspaceStore.DEFAULT_ID, reply["active"]!!.jsonPrimitive.content)
        val list = reply["workspaces"] as JsonArray

        assertEquals(1, list.size)
        val info = list.single().jsonObject
        assertEquals(WorkspaceStore.DEFAULT_ID, info["id"]!!.jsonPrimitive.content)
        assertEquals(WorkspaceStore.DEFAULT_NAME, info["name"]!!.jsonPrimitive.content)
        assertEquals(
            store.directory(WorkspaceStore.DEFAULT_ID).absolutePath,
            info["path"]!!.jsonPrimitive.content
        )
    }

    @Test
    fun `create then open returns the active workspace`() {
        val created = call(
            "workspace.create",
            buildJsonObject { put("name", "Project") }
        ).jsonObject
        val id = created["id"]!!.jsonPrimitive.content
        assertEquals("Project", created["name"]!!.jsonPrimitive.content)

        val opened = call("workspace.open", buildJsonObject { put("id", id) }).jsonObject

        assertEquals(id, opened["id"]!!.jsonPrimitive.content)
        assertEquals(id, store.activeId())
    }

    @Test
    fun `rename keeps the id and delete drops the record`() {
        val id = (call(
            "workspace.create",
            buildJsonObject { put("name", "Before") }
        ).jsonObject)["id"]!!.jsonPrimitive.content

        call("workspace.rename", buildJsonObject { put("id", id); put("name", "After") })
        assertEquals("After", store.list().first { it.id == id }.name)

        val reply = call("workspace.delete", buildJsonObject { put("id", id) }).jsonObject

        assertEquals("true", reply["ok"]!!.jsonPrimitive.content)
        assertTrue(store.list().none { it.id == id })
    }

    @Test
    fun `deleting a workspace purges its drafts`() {
        var current = WorkspaceStore.DEFAULT_ID
        val draftsRoot = createTempDir("workspace-handler-drafts")
        val drafts = Drafts(draftsRoot, workspaceId = { current })
        val withDrafts = WorkspaceHandler(store, BridgeJson.value, drafts)
        val id = (call(
            "workspace.create",
            buildJsonObject { put("name", "Draft project") }
        ).jsonObject)["id"]!!.jsonPrimitive.content
        current = id
        drafts.save("src/main.py", "print('unsaved')")
        val draftDir = File(File(draftsRoot, "drafts"), id)
        assertTrue(draftDir.isDirectory)

        withDrafts.handle("workspace.delete", buildJsonObject { put("id", id) })

        assertFalse("workspace drafts were not purged", draftDir.exists())
        assertFalse(store.list().any { it.id == id })
        assertEquals(0, drafts.list().size)
    }

    @Test
    fun `missing ids and names are bad envelopes`() {
        expect(ErrorCode.E_BAD_ENVELOPE) {
            call("workspace.open", buildJsonObject { put("id", "  ") })
        }
        expect(ErrorCode.E_BAD_ENVELOPE) {
            call("workspace.create")
        }
        expect(ErrorCode.E_BAD_ENVELOPE) {
            call("workspace.create", buildJsonObject { put("name", "a/b") })
        }
    }

    @Test
    fun `unknown workspaces are not found and default cannot be deleted`() {
        expect(ErrorCode.E_NOT_FOUND) {
            call("workspace.open", buildJsonObject { put("id", "nope") })
        }
        expect(ErrorCode.E_PERMISSION) {
            call("workspace.delete", buildJsonObject { put("id", WorkspaceStore.DEFAULT_ID) })
        }
    }

    @Test
    fun `the method table matches the contract`() {
        assertEquals(
            setOf(
                "workspace.list",
                "workspace.create",
                "workspace.open",
                "workspace.rename",
                "workspace.delete"
            ),
            handler.methods()
        )
    }
}
