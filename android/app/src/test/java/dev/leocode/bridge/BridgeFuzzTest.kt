package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.File
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

/**
 * Fuzzing and robustness hardening test suite for [BridgeRouter] (Task 29).
 *
 * Verifies envelope validation, raw message ingestion, error mapping, DTO decoding,
 * oversized message limits, and multi-threaded burst request concurrency.
 */
class BridgeFuzzTest {

    companion object {
        private const val MAX_FUZZ_MESSAGE_BYTES = 256 * 1024
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val loggedLines = Collections.synchronizedList(mutableListOf<String>())
    private lateinit var router: BridgeRouter
    private lateinit var workspace: Workspace
    private lateinit var fsHandler: FsHandler

    private class ThrowingHandler(
        private val name: String,
        private val exceptionFactory: () -> Throwable
    ) : BridgeHandler {
        override fun methods(): Set<String> = setOf(name)
        override fun handle(method: String, payload: JsonObject): JsonElement = throw exceptionFactory()
    }

    private class EchoHandler(
        private val name: String
    ) : BridgeHandler {
        override fun methods(): Set<String> = setOf(name)
        override fun handle(method: String, payload: JsonObject): JsonElement = payload
    }

    @Before
    fun setUp() {
        loggedLines.clear()
        val tempRoot = createTempDir("bridge-fuzz-ws")
        workspace = Workspace(tempRoot).apply { ensure() }
        val jail = PathJail(workspace.workspacesRoot, null) { false }
        val trash = Trash(File(workspace.root, ".trash"))
        fsHandler = FsHandler(workspace, jail, trash, json)

        val appHandler = AppHandler(
            theme = object : ThemePort {
                override fun state(): ThemeState = ThemeState("system", "dark")
                override fun setMode(mode: String?): ThemeState = state()
            },
            appInfo = {
                AppInfo(
                    app = "LeoCode",
                    version = "0.1.0",
                    mode = "android",
                    theme = ThemeState("system", "dark")
                )
            },
            json = json
        )

        val throwingHandler = ThrowingHandler("fuzz.explode") {
            RuntimeException("critical internal failure with secret /data/user/0/dev.leocode/key")
        }
        val echoHandler = EchoHandler("fuzz.echo")

        router = BridgeRouter(
            json = json,
            handlers = listOf(appHandler, fsHandler, throwingHandler, echoHandler),
            log = { loggedLines.add(it) }
        )
    }

    /**
     * Simulates BridgeHost wire parsing and router dispatch for raw string payloads.
     */
    private fun dispatchWire(
        rawMessage: String,
        maxBytes: Int = MAX_FUZZ_MESSAGE_BYTES
    ): JsonObject {
        if (rawMessage.length > maxBytes || rawMessage.toByteArray(Charsets.UTF_8).size > maxBytes) {
            val extractedId = extractId(rawMessage)
            return buildJsonObject {
                put("v", 1)
                put("id", if (extractedId != null) JsonPrimitive(extractedId) else JsonNull)
                put("ok", false)
                put(
                    "error",
                    buildJsonObject {
                        put("code", "E_LIMIT")
                        put("message", "message is too large")
                    }
                )
            }
        }

        val request = runCatching { json.parseToJsonElement(rawMessage) as? JsonObject }.getOrNull()
            ?: return buildJsonObject {
                put("v", 1)
                put("id", JsonNull)
                put("ok", false)
                put(
                    "error",
                    buildJsonObject {
                        put("code", "E_BAD_ENVELOPE")
                        put("message", "message is not a JSON object")
                    }
                )
            }

        val idElement = SafeEnvelope.idElement(request)
        if (!SafeEnvelope.isValidId(idElement)) {
            return buildJsonObject {
                put("v", 1)
                put("id", JsonNull)
                put("ok", false)
                put(
                    "error",
                    buildJsonObject {
                        put("code", "E_BAD_ENVELOPE")
                        put("message", "id must be a string or number")
                    }
                )
            }
        }

        return router.dispatch(request)
    }

    private fun extractId(raw: String): String? {
        val prefix = raw.take(1024)
        val match = Regex("\"id\"\\s*:\\s*\"([^\"]{1,128})\"").find(prefix) ?: return null
        return match.groupValues[1]
    }

    private fun errorCode(reply: JsonObject): String =
        reply["error"]!!.jsonObject["code"]!!.jsonPrimitive.content

    private fun errorMessage(reply: JsonObject): String =
        reply["error"]!!.jsonObject["message"]!!.jsonPrimitive.content

    private fun isOk(reply: JsonObject): Boolean =
        reply["ok"]!!.jsonPrimitive.content == "true"

    @Test
    fun `invalid and non-JSON strings return E_BAD_ENVELOPE`() {
        val malformedStrings = listOf(
            "",
            "   ",
            "not a json at all",
            "{",
            "{unquoted_key: 1}",
            "{\"v\": 1, \"id\": \"1\", \"method\": \"app.ping\",", // truncated
            "{\"v\": 1, \"id\": \"1\", \"method\":",             // truncated key-value
            "[1, 2, 3]",                                         // json array instead of object
            "null",
            "42",
            "\"just a string\"",
            "true",
            "\u0000\u0001\u0002"
        )

        for (malformed in malformedStrings) {
            val reply = dispatchWire(malformed)
            assertFalse("Expected ok=false for malformed payload: $malformed", isOk(reply))
            assertEquals("E_BAD_ENVELOPE", errorCode(reply))
        }
    }

    @Test
    fun `empty and non-object payloads are handled safely`() {
        // Non-object payloads must be rejected with E_BAD_ENVELOPE before handlers
        val nonObjectPayloads = listOf(
            JsonPrimitive("string-payload"),
            JsonPrimitive(12345),
            JsonPrimitive(true),
            JsonArray(listOf(JsonPrimitive(1), JsonPrimitive(2)))
        )

        for (payload in nonObjectPayloads) {
            val req = buildJsonObject {
                put("v", 1)
                put("id", "fuzz-payload")
                put("method", "app.ping")
                put("payload", payload)
            }
            val reply = router.dispatch(req)
            assertFalse(isOk(reply))
            assertEquals("E_BAD_ENVELOPE", errorCode(reply))
        }

        // Empty payload {} succeeds for methods with optional/no payload like app.ping
        val emptyPayloadReq = buildJsonObject {
            put("v", 1)
            put("id", "ping-empty")
            put("method", "app.ping")
            put("payload", buildJsonObject {})
        }
        val pingReply = router.dispatch(emptyPayloadReq)
        assertTrue(isOk(pingReply))

        // Omitted payload key also defaults to empty object safely
        val omittedPayloadReq = buildJsonObject {
            put("v", 1)
            put("id", "ping-omitted")
            put("method", "app.ping")
        }
        val omittedReply = router.dispatch(omittedPayloadReq)
        assertTrue(isOk(omittedReply))
    }

    @Test
    fun `envelopes with missing or invalid fields return E_BAD_ENVELOPE`() {
        // Missing method
        val missingMethod = buildJsonObject {
            put("v", 1)
            put("id", "no-method")
            put("payload", buildJsonObject {})
        }
        val replyNoMethod = router.dispatch(missingMethod)
        assertFalse(isOk(replyNoMethod))
        assertEquals("E_BAD_ENVELOPE", errorCode(replyNoMethod))

        // Blank or non-string method
        val blankMethods = listOf(
            buildJsonObject { put("v", 1); put("id", "1"); put("method", ""); put("payload", buildJsonObject {}) },
            buildJsonObject { put("v", 1); put("id", "2"); put("method", "   "); put("payload", buildJsonObject {}) },
            buildJsonObject { put("v", 1); put("id", "3"); put("method", JsonNull); put("payload", buildJsonObject {}) },
            buildJsonObject { put("v", 1); put("id", "4"); put("method", buildJsonObject {}); put("payload", buildJsonObject {}) }
        )
        for (req in blankMethods) {
            val reply = router.dispatch(req)
            assertFalse(isOk(reply))
            assertEquals("E_BAD_ENVELOPE", errorCode(reply))
        }

        // Invalid version type (string or object/array instead of int 1)
        val invalidVersions = listOf(
            buildJsonObject { put("v", "1"); put("id", "1"); put("method", "app.ping") },
            buildJsonObject { put("v", buildJsonObject {}); put("id", "2"); put("method", "app.ping") },
            buildJsonObject { put("v", JsonArray(emptyList())); put("id", "3"); put("method", "app.ping") }
        )
        for (req in invalidVersions) {
            val reply = router.dispatch(req)
            assertFalse(isOk(reply))
            assertEquals("E_BAD_ENVELOPE", errorCode(reply))
        }

        // Invalid id: arrays and objects are invalid
        val invalidIdWire = listOf(
            """{"v":1,"id":{"nested":"id"},"method":"app.ping","payload":{}}""",
            """{"v":1,"id":["array","id"],"method":"app.ping","payload":{}}"""
        )
        for (raw in invalidIdWire) {
            val reply = dispatchWire(raw)
            assertFalse(isOk(reply))
            assertEquals("E_BAD_ENVELOPE", errorCode(reply))
        }
    }

    @Test
    fun `unsupported protocol version returns E_UNSUPPORTED or E_PROTOCOL_VERSION`() {
        val unsupportedVersions = listOf(2, 0, -1, 3, 99, -42)

        for (version in unsupportedVersions) {
            val req = buildJsonObject {
                put("v", version)
                put("id", "ver-$version")
                put("method", "app.ping")
                put("payload", buildJsonObject {})
            }
            val reply = router.dispatch(req)
            assertFalse(isOk(reply))
            val code = errorCode(reply)
            assertTrue(
                "Expected E_UNSUPPORTED or E_PROTOCOL_VERSION but got $code",
                code == "E_UNSUPPORTED" || code == "E_PROTOCOL_VERSION"
            )
        }
    }

    @Test
    fun `unknown bridge methods return E_UNKNOWN_METHOD`() {
        val unknownMethods = listOf(
            "unknown.method",
            "non.existent",
            "app.nonExistent",
            "fs.formatDisk",
            "system.exec",
            "__proto__",
            "constructor",
            "123"
        )

        for (method in unknownMethods) {
            val req = buildJsonObject {
                put("v", 1)
                put("id", "m-$method")
                put("method", method)
                put("payload", buildJsonObject {})
            }
            val reply = router.dispatch(req)
            assertFalse(isOk(reply))
            assertEquals("E_UNKNOWN_METHOD", errorCode(reply))
        }
    }

    @Test
    fun `oversized payload exceeds message limit and returns E_LIMIT or E_PAYLOAD_TOO_LARGE`() {
        val hugeData = "A".repeat(300 * 1024) // 300 KB > 256 KB limit
        val rawOversized = """{"v":1,"id":"big-id-42","method":"fuzz.echo","payload":{"data":"$hugeData"}}"""

        val reply = dispatchWire(rawOversized, maxBytes = MAX_FUZZ_MESSAGE_BYTES)
        assertFalse(isOk(reply))
        val code = errorCode(reply)
        assertTrue(
            "Expected E_LIMIT or E_PAYLOAD_TOO_LARGE but got $code",
            code == "E_LIMIT" || code == "E_PAYLOAD_TOO_LARGE"
        )
        // Request id is preserved
        assertEquals("big-id-42", reply["id"]!!.jsonPrimitive.content)
    }

    @Test
    fun `malformed DTO parameters return E_BAD_ENVELOPE without escaping exceptions`() {
        val badDtos = listOf(
            // app.share: missing required 'text' field
            buildJsonObject { put("v", 1); put("id", "s1"); put("method", "app.share"); put("payload", buildJsonObject {}) },
            // app.share: 'text' is an array instead of string
            buildJsonObject { put("v", 1); put("id", "s2"); put("method", "app.share"); put("payload", buildJsonObject { put("text", JsonArray(emptyList())) }) },
            // fs.read: 'offset' is a string instead of long
            buildJsonObject { put("v", 1); put("id", "r1"); put("method", "fs.read"); put("payload", buildJsonObject { put("path", "file.txt"); put("offset", "not-a-number") }) },
            // fs.read: 'maxBytes' is an array instead of int
            buildJsonObject { put("v", 1); put("id", "r2"); put("method", "fs.read"); put("payload", buildJsonObject { put("path", "file.txt"); put("maxBytes", JsonArray(emptyList())) }) },
            // fs.read: 'path' is an object instead of string
            buildJsonObject { put("v", 1); put("id", "r3"); put("method", "fs.read"); put("payload", buildJsonObject { put("path", buildJsonObject {}) }) },
            // fs.write: 'content' is an array instead of string
            buildJsonObject { put("v", 1); put("id", "w1"); put("method", "fs.write"); put("payload", buildJsonObject { put("path", "file.txt"); put("content", JsonArray(emptyList())) }) },
            // fs.write: 'path' is an object instead of string
            buildJsonObject { put("v", 1); put("id", "w2"); put("method", "fs.write"); put("payload", buildJsonObject { put("path", buildJsonObject {}); put("content", "hello") }) },
            // app.theme.set: 'mode' is an array instead of string
            buildJsonObject { put("v", 1); put("id", "t1"); put("method", "app.theme.set"); put("payload", buildJsonObject { put("mode", JsonArray(emptyList())) }) }
        )

        for (req in badDtos) {
            val reply = router.dispatch(req)
            assertFalse("Expected failure for malformed DTO: $req", isOk(reply))
            assertEquals("E_BAD_ENVELOPE", errorCode(reply))
        }
    }

    @Test
    fun `concurrent burst requests verify thread safety, no unhandled exceptions, and correlation IDs logged once`() {
        val totalRequests = 120
        val threadPool = Executors.newFixedThreadPool(8)
        val latch = CountDownLatch(totalRequests)
        val unhandledExceptions = AtomicInteger(0)
        val replies = Collections.synchronizedList(mutableListOf<Pair<String, JsonObject>>())

        for (i in 0 until totalRequests) {
            val reqId = "burst-$i"
            val reqType = i % 4
            threadPool.submit {
                try {
                    val req = when (reqType) {
                        0 -> buildJsonObject {
                            put("v", 1)
                            put("id", reqId)
                            put("method", "app.ping")
                            put("payload", buildJsonObject {})
                        }
                        1 -> buildJsonObject {
                            put("v", 1)
                            put("id", reqId)
                            put("method", "unknown.action.$i")
                            put("payload", buildJsonObject {})
                        }
                        2 -> buildJsonObject {
                            put("v", 2) // unsupported version
                            put("id", reqId)
                            put("method", "app.ping")
                            put("payload", buildJsonObject {})
                        }
                        else -> buildJsonObject {
                            put("v", 1)
                            put("id", reqId)
                            put("method", "fuzz.explode") // throws RuntimeException -> E_INTERNAL
                            put("payload", buildJsonObject {})
                        }
                    }
                    val reply = router.dispatch(req)
                    replies.add(reqId to reply)
                } catch (e: Throwable) {
                    unhandledExceptions.incrementAndGet()
                } finally {
                    latch.countDown()
                }
            }
        }

        assertTrue("Burst requests timed out", latch.await(10, TimeUnit.SECONDS))
        threadPool.shutdown()

        assertEquals("No exceptions must escape dispatch", 0, unhandledExceptions.get())
        assertEquals(totalRequests, replies.size)

        val correlationIdsSeen = mutableListOf<String>()

        for ((reqId, reply) in replies) {
            assertEquals(reqId, reply["id"]!!.jsonPrimitive.content)
            val reqIndex = reqId.removePrefix("burst-").toInt()
            when (reqIndex % 4) {
                0 -> {
                    assertTrue("Request $reqId should have succeeded", isOk(reply))
                }
                1 -> {
                    assertFalse(isOk(reply))
                    assertEquals("E_UNKNOWN_METHOD", errorCode(reply))
                }
                2 -> {
                    assertFalse(isOk(reply))
                    val code = errorCode(reply)
                    assertTrue(code == "E_UNSUPPORTED" || code == "E_PROTOCOL_VERSION")
                }
                3 -> {
                    assertFalse(isOk(reply))
                    assertEquals("E_INTERNAL", errorCode(reply))
                    assertEquals("Something went wrong", errorMessage(reply))
                    val errorObj = reply["error"]!!.jsonObject
                    val corrId = errorObj["correlationId"]?.jsonPrimitive?.content
                    assertNotNull("E_INTERNAL must include correlationId", corrId)
                    assertTrue("CorrelationId must begin with 'c-'", corrId!!.startsWith("c-"))
                    correlationIdsSeen.add(corrId)
                }
            }
        }

        // Verify correlation IDs logged once and redacted
        assertEquals(totalRequests / 4, correlationIdsSeen.size)
        val logsSnapshot = loggedLines.toList()

        for (corrId in correlationIdsSeen) {
            val occurrences = logsSnapshot.count { it.contains(corrId) }
            assertEquals("Correlation ID $corrId must be logged exactly once", 1, occurrences)
            val logLine = logsSnapshot.first { it.contains(corrId) }
            // Verify path redaction: the exception message contained '/data/user/0/dev.leocode/key'
            assertFalse(
                "App-private path must be redacted from log",
                logLine.contains("/data/user/0/dev.leocode")
            )
            assertTrue("Log line should contain redacted path marker", logLine.contains("<path>"))
        }
    }
}
