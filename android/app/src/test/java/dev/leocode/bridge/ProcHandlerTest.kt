package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.ProcessSupervisor
import dev.leocode.core.Workspace
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test

/**
 * `proc.run` must resolve a relative cwd against the *active* workspace. Before
 * Task 26 it always used the default workspace, so Run in any other project
 * executed from the wrong directory (or failed on a missing script).
 */
class ProcHandlerTest {

    private val sh = File("/bin/sh")

    @Before
    fun requireShell() {
        assumeTrue(sh.canExecute())
    }

    @Test
    fun `relative cwd uses the active workspace`() {
        val root = Files.createTempDirectory("leocode-proc-handler").toFile()
            .also { it.deleteOnExit() }
        val workspace = Workspace(root)
        workspace.ensure()
        val active = File(workspace.workspacesRoot, "active").apply { mkdirs() }
        val supervisor = ProcessSupervisor()
        val handler = ProcHandler(
            workspace,
            PathJail(workspaceRoot = workspace.workspacesRoot),
            supervisor,
            { active }
        )

        val output = StringBuffer()
        val done = CountDownLatch(1)
        val sink = object : StreamSink {
            override fun event(name: String, payload: kotlinx.serialization.json.JsonElement) {
                if (name == "proc.exit") done.countDown()
            }

            override fun text(name: String, text: String) {
                if (name == "proc.stdout") output.append(text)
            }

            override fun bytes(name: String, bytes: ByteArray) = Unit
        }

        try {
            handler.handle(
                "proc.run",
                Json.encodeToJsonElement(ProcRunRequest.serializer(), ProcRunRequest(
                    argv = listOf("/bin/sh", "-c", "pwd"),
                    cwd = "."
                )).jsonObject,
                sink
            )
            assertTrue("process did not exit", done.await(5, TimeUnit.SECONDS))
            assertEquals(active.canonicalPath, output.toString().trim())
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `proc stdin writes to a job started with stdin enabled`() {
        val root = Files.createTempDirectory("leocode-proc-handler").toFile()
            .also { it.deleteOnExit() }
        val workspace = Workspace(root).apply { ensure() }
        val supervisor = ProcessSupervisor()
        val handler = ProcHandler(
            workspace,
            PathJail(workspaceRoot = workspace.workspacesRoot),
            supervisor,
            { workspace.defaultWorkspace }
        )

        val output = StringBuffer()
        val done = CountDownLatch(1)
        val sink = object : StreamSink {
            override fun event(name: String, payload: kotlinx.serialization.json.JsonElement) {
                if (name == "proc.exit") done.countDown()
            }

            override fun text(name: String, text: String) {
                if (name == "proc.stdout") output.append(text)
            }

            override fun bytes(name: String, bytes: ByteArray) = Unit
        }

        try {
            val reply = handler.handle(
                "proc.run",
                Json.encodeToJsonElement(ProcRunRequest.serializer(), ProcRunRequest(
                    argv = listOf("/bin/sh", "-c", "IFS= read -r line && printf 'Got:%s' \"\$line\""),
                    cwd = ".",
                    stdin = true
                )).jsonObject,
                sink
            )
            val jobId = reply.jsonObject["jobId"]!!.toString().trim('"')

            val written = handler.handle(
                "proc.stdin",
                Json.encodeToJsonElement(ProcStdinRequest.serializer(), ProcStdinRequest(
                    jobId = jobId,
                    data = "LeoCode\n"
                )).jsonObject
            )
            assertEquals(
                true,
                written.jsonObject["written"]!!.toString().toBoolean()
            )
            assertTrue("process did not exit", done.await(5, TimeUnit.SECONDS))
            assertEquals("Got:LeoCode", output.toString())
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `proc stdin reports false for an unknown job`() {
        val root = Files.createTempDirectory("leocode-proc-handler").toFile()
            .also { it.deleteOnExit() }
        val workspace = Workspace(root).apply { ensure() }
        val supervisor = ProcessSupervisor()
        val handler = ProcHandler(
            workspace,
            PathJail(workspaceRoot = workspace.workspacesRoot),
            supervisor,
            { workspace.defaultWorkspace }
        )

        try {
            val reply = handler.handle(
                "proc.stdin",
                Json.encodeToJsonElement(ProcStdinRequest.serializer(), ProcStdinRequest(
                    jobId = "missing",
                    data = "x\n"
                )).jsonObject
            )
            assertEquals(false, reply.jsonObject["written"]!!.toString().toBoolean())
        } finally {
            supervisor.close()
        }
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
    fun `root run returns E_ROOT_UNAVAILABLE when root is not available`() {
        val root = Files.createTempDirectory("leocode-proc-handler").toFile().also { it.deleteOnExit() }
        val workspace = Workspace(root).apply { ensure() }
        val supervisor = ProcessSupervisor()
        val manager = dev.leocode.core.RootManager(
            prefs = FakeRootPrefs(enabled = true),
            shellRunner = FakeShellRunner(),
            pathCandidates = emptyList(),
            pathEnv = ""
        )
        val handler = ProcHandler(
            workspace,
            PathJail(workspaceRoot = workspace.workspacesRoot),
            supervisor,
            { workspace.defaultWorkspace },
            rootManager = manager
        )

        try {
            handler.handle(
                "proc.run",
                Json.encodeToJsonElement(ProcRunRequest.serializer(), ProcRunRequest(
                    argv = listOf("echo", "hi"),
                    cwd = ".",
                    root = true
                )).jsonObject
            )
            org.junit.Assert.fail("expected E_ROOT_UNAVAILABLE")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_UNAVAILABLE, e.errorCode)
        } finally {
            supervisor.close()
        }
    }

    @Test
    fun `root run returns E_ROOT_DENIED when canUseRoot is false`() {
        val root = Files.createTempDirectory("leocode-proc-handler").toFile().also { it.deleteOnExit() }
        val workspace = Workspace(root).apply { ensure() }
        val supervisor = ProcessSupervisor()
        val fakeSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = dev.leocode.core.RootManager(
            prefs = FakeRootPrefs(enabled = false),
            shellRunner = FakeShellRunner(),
            pathCandidates = listOf(fakeSu.absolutePath),
            pathEnv = ""
        )
        val handler = ProcHandler(
            workspace,
            PathJail(workspaceRoot = workspace.workspacesRoot),
            supervisor,
            { workspace.defaultWorkspace },
            rootManager = manager
        )

        try {
            handler.handle(
                "proc.run",
                Json.encodeToJsonElement(ProcRunRequest.serializer(), ProcRunRequest(
                    argv = listOf("echo", "hi"),
                    cwd = ".",
                    root = true
                )).jsonObject
            )
            org.junit.Assert.fail("expected E_ROOT_DENIED")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_DENIED, e.errorCode)
        } finally {
            supervisor.close()
            fakeSu.delete()
        }
    }
}
