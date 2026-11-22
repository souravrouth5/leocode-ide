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
}
