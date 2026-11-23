package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.Workspace
import dev.leocode.core.language.LanguageProvider
import dev.leocode.core.language.LanguageRegistry
import dev.leocode.core.language.PythonLanguageProvider
import dev.leocode.core.language.RunCommandPlan
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class LanguageHandlerTest {

    @get:Rule
    val temp = TemporaryFolder()

    private val json = Json { ignoreUnknownKeys = true }

    private class FakeProvider(
        override val id: String = "test-lang",
        override val displayName: String = "Test Language",
        override val runtimeId: String? = null,
        override val extensions: List<String> = listOf("test"),
        override val supportsRepl: Boolean = false,
        override val trustTriggers: List<String> = emptyList(),
        override val requiresRuntime: Boolean = false
    ) : LanguageProvider {
        override fun buildRunCommand(projectDir: File, fileRelPath: String): RunCommandPlan =
            RunCommandPlan(argv = listOf("test-runner", fileRelPath), env = mapOf("TEST" to "true"), cwd = projectDir)
    }

    @Test
    fun `language list returns registered descriptors`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val jail = PathJail(workspace.workspacesRoot)
        val registry = LanguageRegistry(listOf(PythonLanguageProvider(workspace), FakeProvider()))

        val handler = LanguageHandler(registry, { workspace.root }, jail, json)
        val result = handler.handle("language.list", buildJsonObject {})
        val reply = json.decodeFromJsonElement(LanguageListReply.serializer(), result)

        val languages = reply.languages ?: emptyList()
        assertEquals(2, languages.size)
        assertEquals("python", languages[0].id)
        assertEquals("test-lang", languages[1].id)
    }

    @Test
    fun `language list works when registry is empty`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val jail = PathJail(workspace.workspacesRoot)
        val registry = LanguageRegistry(emptyList())

        val handler = LanguageHandler(registry, { workspace.root }, jail, json)
        val result = handler.handle("language.list", buildJsonObject {})
        val reply = json.decodeFromJsonElement(LanguageListReply.serializer(), result)

        assertTrue((reply.languages ?: emptyList()).isEmpty())
    }

    @Test
    fun `language plan returns run plan for supported file`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val project = temp.newFolder("project")
        val jail = PathJail(workspace.workspacesRoot)
        val registry = LanguageRegistry(listOf(FakeProvider()))

        val handler = LanguageHandler(registry, { project }, jail, json)
        val req = buildJsonObject {
            put("file", "script.test")
        }
        val result = handler.handle("language.plan", req)
        val reply = json.decodeFromJsonElement(LanguagePlanReply.serializer(), result)

        assertEquals("test-lang", reply.languageId)
        assertEquals(listOf("test-runner", "script.test"), reply.argv)
        assertEquals("true", reply.env?.get("TEST"))
        assertEquals(project.absolutePath, reply.cwd)
    }

    @Test
    fun `language plan throws E_UNSUPPORTED for unregistered extension`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val jail = PathJail(workspace.workspacesRoot)
        val registry = LanguageRegistry(emptyList())

        val handler = LanguageHandler(registry, { workspace.root }, jail, json)
        val req = buildJsonObject {
            put("file", "unknown.xyz")
        }

        try {
            handler.handle("language.plan", req)
            fail("expected BridgeException(E_UNSUPPORTED)")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_UNSUPPORTED, e.errorCode)
        }
    }
}
