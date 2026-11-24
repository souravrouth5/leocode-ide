package dev.leocode.bridge

import dev.leocode.core.RootManager
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

class RootHandlerTest {

    private class FakeRootPrefs(private var enabled: Boolean = false) : RootManager.RootPrefs {
        override fun isEnabled(): Boolean = enabled
        override fun setEnabled(enabled: Boolean) {
            this.enabled = enabled
        }
    }

    private class FakeShellRunner : RootManager.ShellRunner {
        var nextExitCode = 0
        val commands = mutableListOf<List<String>>()

        override fun run(command: List<String>, timeoutMs: Long): RootManager.ShellResult {
            commands.add(command)
            return RootManager.ShellResult(nextExitCode, "", "")
        }
    }

    @Test
    fun `root status returns unavailable when su missing`() {
        val manager = RootManager(
            prefs = FakeRootPrefs(),
            shellRunner = FakeShellRunner(),
            pathCandidates = emptyList(),
            pathEnv = ""
        )
        val handler = RootHandler(manager)

        val reply = handler.handle("root.status", JsonObject(emptyMap())).jsonObject
        assertEquals(false, reply["available"]?.jsonPrimitive?.boolean)
        assertEquals(false, reply["granted"]?.jsonPrimitive?.boolean)
        assertEquals(false, reply["enabled"]?.jsonPrimitive?.boolean)
    }

    @Test
    fun `root request returns granted true on success`() {
        val tempSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = RootManager(
            prefs = FakeRootPrefs(false),
            shellRunner = FakeShellRunner().apply { nextExitCode = 0 },
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )
        val handler = RootHandler(manager)

        val reply = handler.handle("root.request", JsonObject(emptyMap())).jsonObject
        assertEquals(true, reply["granted"]?.jsonPrimitive?.boolean)

        val status = handler.handle("root.status", JsonObject(emptyMap())).jsonObject
        assertEquals(true, status["available"]?.jsonPrimitive?.boolean)
        assertEquals(true, status["granted"]?.jsonPrimitive?.boolean)
        assertEquals(true, status["enabled"]?.jsonPrimitive?.boolean)

        tempSu.delete()
    }

    @Test
    fun `root request throws E_ROOT_DENIED on failure`() {
        val tempSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = RootManager(
            prefs = FakeRootPrefs(false),
            shellRunner = FakeShellRunner().apply { nextExitCode = 1 },
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )
        val handler = RootHandler(manager)

        try {
            handler.handle("root.request", JsonObject(emptyMap()))
            fail("expected E_ROOT_DENIED")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_ROOT_DENIED, e.errorCode)
        }

        tempSu.delete()
    }

    @Test
    fun `root disable with prefs enabled disables prefs calls hook and runs no shell commands`() {
        val prefs = FakeRootPrefs(enabled = true)
        val shellRunner = FakeShellRunner()
        val tempSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val manager = RootManager(
            prefs = prefs,
            shellRunner = shellRunner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )
        var onDisabledCalls = 0
        val handler = RootHandler(
            rootManager = manager,
            onDisabled = { onDisabledCalls++ }
        )

        val reply = handler.handle("root.disable", JsonObject(emptyMap())).jsonObject
        assertEquals(false, reply["enabled"]?.jsonPrimitive?.boolean)
        assertEquals(false, reply["granted"]?.jsonPrimitive?.boolean)
        assertEquals(false, prefs.isEnabled())
        assertEquals(1, onDisabledCalls)
        assertEquals(0, shellRunner.commands.size)

        tempSu.delete()
    }

    @Test
    fun `root disable twice calls onDisabled twice without exception`() {
        val prefs = FakeRootPrefs(enabled = true)
        val shellRunner = FakeShellRunner()
        val manager = RootManager(
            prefs = prefs,
            shellRunner = shellRunner,
            pathCandidates = emptyList(),
            pathEnv = ""
        )
        var onDisabledCalls = 0
        val handler = RootHandler(
            rootManager = manager,
            onDisabled = { onDisabledCalls++ }
        )

        val reply1 = handler.handle("root.disable", JsonObject(emptyMap())).jsonObject
        assertEquals(false, reply1["enabled"]?.jsonPrimitive?.boolean)

        val reply2 = handler.handle("root.disable", JsonObject(emptyMap())).jsonObject
        assertEquals(false, reply2["enabled"]?.jsonPrimitive?.boolean)

        assertEquals(2, onDisabledCalls)
        assertEquals(0, shellRunner.commands.size)
    }

    @Test
    fun `root disable when onDisabled throws still succeeds and logs error`() {
        val prefs = FakeRootPrefs(enabled = true)
        val manager = RootManager(
            prefs = prefs,
            shellRunner = FakeShellRunner(),
            pathCandidates = emptyList(),
            pathEnv = ""
        )
        val logMessages = mutableListOf<String>()
        val handler = RootHandler(
            rootManager = manager,
            onDisabled = { throw RuntimeException("boom") },
            log = { logMessages.add(it) }
        )

        val reply = handler.handle("root.disable", JsonObject(emptyMap())).jsonObject
        assertEquals(false, reply["enabled"]?.jsonPrimitive?.boolean)
        assertEquals(false, prefs.isEnabled())
        val hasHookError = logMessages.any { it.contains("root.disable onDisabled hook failed: boom") }
        assertEquals(true, hasHookError)
    }

    @Test
    fun `root status with prefs enabled runs no shell commands`() {
        val tempSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val prefs = FakeRootPrefs(enabled = true)
        val shellRunner = FakeShellRunner()
        val manager = RootManager(
            prefs = prefs,
            shellRunner = shellRunner,
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )
        val handler = RootHandler(manager)

        val reply = handler.handle("root.status", JsonObject(emptyMap())).jsonObject
        assertEquals(true, reply["available"]?.jsonPrimitive?.boolean)
        assertEquals(true, reply["enabled"]?.jsonPrimitive?.boolean)
        assertEquals(0, shellRunner.commands.size)

        tempSu.delete()
    }

    @Test
    fun `root status logs only when status changes`() {
        val tempSu = File.createTempFile("fake_su", "").apply { deleteOnExit() }
        val prefs = FakeRootPrefs(enabled = false)
        val manager = RootManager(
            prefs = prefs,
            shellRunner = FakeShellRunner(),
            pathCandidates = listOf(tempSu.absolutePath),
            pathEnv = ""
        )
        val logs = mutableListOf<String>()
        val handler = RootHandler(
            rootManager = manager,
            log = { logs.add(it) }
        )

        handler.handle("root.status", JsonObject(emptyMap()))
        handler.handle("root.status", JsonObject(emptyMap()))
        assertEquals(1, logs.filter { it.startsWith("root.status =>") }.size)

        prefs.setEnabled(true)
        handler.handle("root.status", JsonObject(emptyMap()))
        assertEquals(2, logs.filter { it.startsWith("root.status =>") }.size)

        tempSu.delete()
    }

    @Test
    fun `unknown method throws E_UNKNOWN_METHOD`() {
        val manager = RootManager(
            prefs = FakeRootPrefs(),
            shellRunner = FakeShellRunner(),
            pathCandidates = emptyList(),
            pathEnv = ""
        )
        val handler = RootHandler(manager)

        try {
            handler.handle("root.unknown", JsonObject(emptyMap()))
            fail("expected E_UNKNOWN_METHOD")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_UNKNOWN_METHOD, e.errorCode)
        }
    }
}
