package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.PtyProcess
import dev.leocode.core.TerminalRegistry
import dev.leocode.core.Workspace
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.nio.file.Files

class TermHandlerTest {

    private class FakePty(override val pid: Int = 100) : PtyProcess {
        override val isClosed: Boolean = false
        override fun write(bytes: ByteArray): Int = bytes.size
        override fun readBlocking(maxBytes: Int): ByteArray? = null
        override fun resize(rows: Int, cols: Int) = Unit
        override fun waitFor(): Int = 0
        override fun destroy() = Unit
    }

    private class FakeRootPrefs(private var enabled: Boolean = true) : dev.leocode.core.RootManager.RootPrefs {
        override fun isEnabled(): Boolean = enabled
        override fun setEnabled(enabled: Boolean) {
            this.enabled = enabled
        }
    }

    private class FakeShellRunner : dev.leocode.core.RootManager.ShellRunner {
        override fun run(command: List<String>, timeoutMs: Long): dev.leocode.core.RootManager.ShellResult =
            dev.leocode.core.RootManager.ShellResult(0, "", "")
    }

    @Test
    fun `root open returns E_ROOT_UNAVAILABLE when root is not available`() {
        val root = Files.createTempDirectory("leocode-term-handler").toFile().also { it.deleteOnExit() }
        val workspace = Workspace(root).apply { ensure() }
        val registry = TerminalRegistry(spawn = { _, _, _, _, _ -> FakePty() })
        val manager = dev.leocode.core.RootManager(
            prefs = FakeRootPrefs(enabled = true),
            shellRunner = FakeShellRunner(),
            pathCandidates = emptyList(),
            pathEnv = ""
        )
        val handler = TermHandler(
            workspace,
            PathJail(workspaceRoot = workspace.workspacesRoot),
            emptyMap(),
            registry,
            rootManager = manager
        )

        try {
            handler.handle(
                "term.open",
                Json.encodeToJsonElement(TermOpenRequest.serializer(), TermOpenRequest(
                    cwd = ".",
                    root = true
                )).jsonObject
            )
            fail("expected E_ROOT_UNAVAILABLE")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_UNAVAILABLE, e.errorCode)
        } finally {
            registry.closeAll()
        }
    }

    @Test
    fun `root open returns E_ROOT_DENIED when canUseRoot is false`() {
        val root = Files.createTempDirectory("leocode-term-handler").toFile().also { it.deleteOnExit() }
        val workspace = Workspace(root).apply { ensure() }
        val registry = TerminalRegistry(spawn = { _, _, _, _, _ -> FakePty() })
        val fakeSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = dev.leocode.core.RootManager(
            prefs = FakeRootPrefs(enabled = false),
            shellRunner = FakeShellRunner(),
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        val handler = TermHandler(
            workspace,
            PathJail(workspaceRoot = workspace.workspacesRoot),
            emptyMap(),
            registry,
            rootManager = manager
        )

        try {
            handler.handle(
                "term.open",
                Json.encodeToJsonElement(TermOpenRequest.serializer(), TermOpenRequest(
                    cwd = ".",
                    root = true
                )).jsonObject
            )
            fail("expected E_ROOT_DENIED")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_DENIED, e.errorCode)
        } finally {
            registry.closeAll()
            fakeSu.delete()
        }
    }
}
