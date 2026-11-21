package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.TrustStore
import dev.leocode.core.Workspace
import java.io.File
import java.nio.file.Files
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustHandlerTest {

    private fun setup(): Triple<TrustHandler, Workspace, File> {
        val root = Files.createTempDirectory("leocode-trust-handler").toFile()
            .also { it.deleteOnExit() }
        val workspace = Workspace(root)
        workspace.ensure()
        val project = File(workspace.workspacesRoot, "default").apply { mkdirs() }
        val jail = PathJail(workspaceRoot = workspace.workspacesRoot)
        val handler = TrustHandler(
            workspace,
            jail,
            { project },
            TrustStore(File(root, "trust.json"))
        )
        return Triple(handler, workspace, project)
    }

    private fun request(path: String? = null, action: String = "script") = buildJsonObject {
        put("action", action)
        if (path != null) put("path", path)
    }

    @Test
    fun `grant then check uses the file fingerprint`() {
        val (handler, _, project) = setup()
        File(project, "main.py").writeText("print(1)\n")

        val granted = handler.handle("trust.grant", request("main.py"))
        val trusted = handler.handle("trust.check", request("main.py"))
        assertTrue(Json.decodeFromJsonElement(TrustReply.serializer(), granted).trusted)
        assertTrue(Json.decodeFromJsonElement(TrustReply.serializer(), trusted).trusted)

        File(project, "main.py").writeText("print(2)\n")
        val changed = handler.handle("trust.check", request("main.py"))
        assertFalse(Json.decodeFromJsonElement(TrustReply.serializer(), changed).trusted)
    }

    @Test(expected = BridgeException::class)
    fun `unknown action is rejected`() {
        val (handler, _, _) = setup()
        handler.handle("trust.check", request("main.py", action = "install-everything"))
    }

    @Test(expected = BridgeException::class)
    fun `a project outside the workspace is rejected`() {
        val (handler, _, _) = setup()
        handler.handle("trust.check", request("/data/data/dev.leocode/files/usr/bin/python3"))
    }
}
