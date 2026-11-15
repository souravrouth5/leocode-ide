package dev.leocode.bridge

import dev.leocode.git.GitEngine
import dev.leocode.ssh.HostKeyPrompts
import dev.leocode.ssh.KnownHostsStore
import dev.leocode.ssh.SshKeyStore
import dev.leocode.ssh.TestSecrets
import java.io.File
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Phase F handlers through the real router: payload shapes, method registration
 * and the "no secret in a reply" rule.
 */
class PhaseFHandlerTest {

    @Test
    fun `git status works through the router`() {
        val router = router()
        val reply = router.dispatch(request("git.status"))
        val payload = reply.payload()

        assertFalse(payload.getValue("initialized").jsonPrimitive.content.toBoolean())
    }

    @Test
    fun `tokens are stored but only hosts are listed`() {
        val router = router()
        assertTrue(router.dispatch(request("secrets.token.set", "host" to "github.com", "token" to "s3cret")).ok())

        val listed = router.dispatch(request("secrets.token.list")).payload()
        val hosts = listed.array("hosts")
        assertEquals(listOf("github.com"), hosts.map { it.jsonPrimitive.content })

        assertFalse(listed.toString().contains("s3cret"))
        assertTrue(router.dispatch(request("secrets.token.delete", "host" to "github.com")).ok())
    }

    @Test
    fun `ssh key generate and list return public data only`() {
        val router = router()
        val generated = router.dispatch(request("ssh.keys.generate", "type" to "ed25519")).payload()

        assertTrue(generated.getValue("publicKey").jsonPrimitive.content.startsWith("ssh-ed25519 "))
        assertTrue(generated.getValue("fingerprint").jsonPrimitive.content.startsWith("SHA256:"))
        assertFalse(generated.toString().contains("PRIVATE"))

        val listed = router.dispatch(request("ssh.keys.list")).payload()
        assertEquals(1, listed.array("keys").size)
    }

    @Test
    fun `known hosts list is empty before any trust`() {
        val router = router()
        val listed = router.dispatch(request("ssh.hostkey.list")).payload()
        assertTrue(listed.array("hosts").isEmpty())
    }

    @Test
    fun `unknown methods are rejected`() {
        val reply = router().dispatch(request("git.nope"))
        assertFalse(reply.ok())
        assertEquals(
            ErrorCode.E_UNKNOWN_METHOD.code,
            reply.getValue("error").jsonObject.getValue("code").jsonPrimitive.content
        )
    }

    /**
     * The token path's security claim, which a device row could only have shown
     * once: a token handed to `git.remote.set` is stored, never returned by
     * `git.remote.list`, and reported only as `hasToken`.
     */
    @Test
    fun `remote token is stored but only flagged in replies`() {
        val router = router()
        router.dispatch(request("git.init", "path" to "repo", "branch" to "main"))

        val set = router.dispatch(
            request(
                "git.remote.set",
                "path" to "repo",
                "name" to "origin",
                "url" to "https://example.test/owner/repo.git",
                "authKind" to "https",
                "username" to "x-access-token",
                "token" to "ghp_supersecretvalue"
            )
        )
        assertTrue(set.ok())
        assertFalse("token leaked into the set reply", set.payload().toString().contains("ghp_supersecretvalue"))

        val listed = router.dispatch(request("git.remote.list", "path" to "repo"))
        assertTrue(listed.ok())
        val payload = listed.payload().toString()
        assertFalse("token leaked into the list reply", payload.contains("ghp_supersecretvalue"))

        val remotes = listed.payload().array("remotes")
        assertEquals(1, remotes.size)
        val remote = remotes.single().jsonObject
        assertEquals("origin", remote.getValue("name").jsonPrimitive.content)
        assertTrue(remote.getValue("hasToken").jsonPrimitive.content.toBoolean())
        assertEquals("x-access-token", remote.getValue("username").jsonPrimitive.content)

        // An empty token clears the stored secret instead of storing "".
        val cleared = router.dispatch(
            request(
                "git.remote.set",
                "path" to "repo",
                "name" to "origin",
                "url" to "https://example.test/owner/repo.git",
                "authKind" to "https",
                "token" to ""
            )
        )
        assertTrue(cleared.ok())
        assertFalse(
            cleared.payload().array("remotes").single().jsonObject
                .getValue("hasToken").jsonPrimitive.content.toBoolean()
        )
    }

    private fun router(): BridgeRouter {
        val state = File(workspace, "state")
        val secrets = TestSecrets.store(state)
        val keys = SshKeyStore(File(state, "ssh"), secrets, BridgeJson.value)
        val knownHosts = KnownHostsStore(File(state, "ssh/known_hosts"))
        val prompts = HostKeyPrompts(knownHosts)
        val engine = GitEngine(
            workspaceRoot = { workspace },
            secrets = secrets,
            keyStore = keys,
            knownHosts = knownHosts,
            prompts = prompts,
            json = BridgeJson.value
        )
        return BridgeRouter(
            BridgeJson.value,
            listOf(
                GitHandler(engine),
                SecretHandler(secrets),
                SshHandler(keys, knownHosts, prompts)
            )
        )
    }

    private fun request(
        method: String,
        vararg payload: Pair<String, String>
    ): JsonObject = buildJsonObject {
        put("v", 1)
        put("id", "req-1")
        put("method", method)
        put("payload", buildJsonObject {
            for ((key, value) in payload) put(key, value)
        })
    }

    private fun JsonObject.ok(): Boolean =
        getValue("ok").jsonPrimitive.content.toBoolean()

    private fun JsonObject.payload(): JsonObject = getValue("payload").jsonObject

    private fun JsonObject.array(name: String): List<kotlinx.serialization.json.JsonElement> =
        (getValue(name) as? kotlinx.serialization.json.JsonArray)?.toList() ?: emptyList()

    @Test
    fun `router lists every Phase F method`() {
        val methods = router().methods
        assertTrue(methods.containsAll(GitHandler.METHODS))
        assertTrue(methods.containsAll(SecretHandler.METHODS))
        assertTrue(methods.containsAll(SshHandler.METHODS))
    }

    private val workspace: File by lazy {
        java.nio.file.Files.createTempDirectory("phase-f-handlers").toFile()
            .also { it.deleteOnExit() }
    }
}
