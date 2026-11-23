package dev.leocode.bridge

import dev.leocode.core.RootManager
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
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
        override fun run(command: List<String>, timeoutMs: Long): RootManager.ShellResult =
            RootManager.ShellResult(nextExitCode, "", "")
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
}
