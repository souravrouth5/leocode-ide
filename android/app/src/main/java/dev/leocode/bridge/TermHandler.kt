package dev.leocode.bridge

import dev.leocode.core.ChildEnv
import dev.leocode.core.PathJail
import dev.leocode.core.TerminalRegistry
import dev.leocode.core.Workspace
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import java.io.Closeable
import java.io.File
import java.util.Base64

/**
 * `term.*`, `docs/bridge-contract.md` (Tasks 6, 10).
 *
 * Sessions live in [TerminalRegistry], not in this handler. That is what lets a
 * session outlive the Activity/WebView that started it: the new page calls
 * `term.attach` and receives the ring-buffer scrollback plus live data.
 *
 * `term.attach` is answered asynchronously so the scrollback reply is posted
 * before the first live `term.data` event.
 */
class TermHandler(
    private val workspace: Workspace,
    private val jail: PathJail,
    private val childEnv: Map<String, String>,
    private val registry: TerminalRegistry,
    private val json: Json = BridgeJson.value
) : AsyncBridgeHandler, Closeable {

    companion object {
        val METHODS = setOf(
            "term.open",
            "term.attach",
            "term.list",
            "term.write",
            "term.resize",
            "term.close",
            "term.ack"
        )
        private const val DEFAULT_COLS = TerminalRegistry.DEFAULT_COLS
        private const val DEFAULT_ROWS = TerminalRegistry.DEFAULT_ROWS
        private const val INITIAL_CREDIT = TerminalRegistry.INITIAL_CREDIT
    }

    override fun methods(): Set<String> = METHODS

    /**
     * Async entry point used by the router. `term.open` and `term.attach` send
     * their reply first and only then start streaming, so the browser sees the
     * session (and scrollback) before the first live `term.data`.
     */
    override fun handle(
        method: String,
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        when (method) {
            "term.open" -> open(payload, respond, sink)
            "term.attach" -> attach(payload, respond, sink)
            else -> respond(AsyncReply.Ok(handle(method, payload, sink)))
        }
    }

    override fun handle(method: String, payload: JsonObject): JsonElement =
        handle(method, payload, NoopStreamSink)

    private fun handle(method: String, payload: JsonObject, sink: StreamSink): JsonElement = when (method) {
        // Synchronous dispatch (tests) gets the reply once streaming has begun.
        "term.open" -> openSession(payload, sink).let { opened ->
            opened.attachment.start()
            opened.reply
        }
        "term.list" -> list()
        "term.write" -> write(payload)
        "term.resize" -> resize(payload)
        "term.close" -> closeSession(payload)
        "term.ack" -> ack(payload)
        "term.attach" -> throw BridgeException(
            ErrorCode.E_INTERNAL,
            "term.attach needs an asynchronous reply"
        )
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    /** Kill every session (the notification's Stop all action). */
    override fun close() {
        registry.closeAll()
    }

    /** Drop listeners but keep PTYs alive; used when the Activity or renderer dies. */
    fun detachAll() {
        registry.detachAll()
    }

    private class OpenedSession(
        val reply: JsonElement,
        val attachment: TerminalRegistry.Attachment
    )

    private fun open(payload: JsonObject, respond: (AsyncReply) -> Unit, sink: StreamSink) {
        val opened = openSession(payload, sink)
        respond(AsyncReply.Ok(opened.reply))
        // The reply is queued on the main thread; live data posted after it.
        opened.attachment.start()
    }

    /**
     * Spawns the PTY and attaches this request's stream. The caller must send the
     * reply before [TerminalRegistry.Attachment.start], so the browser knows the
     * session id before the first `term.data`.
     */
    private fun openSession(payload: JsonObject, sink: StreamSink): OpenedSession {
        val request = json.decodePayload(TermOpenRequest.serializer(), payload, "term.open")
        val cwd = resolve(request.cwd ?: ".")
        if (!cwd.isDirectory) throw BridgeException(ErrorCode.E_NOT_DIR, "cwd is not a directory")

        val opened = registry.open(
            cwd,
            ChildEnv.build(childEnv) + ("PWD" to cwd.absolutePath),
            request.rows ?: DEFAULT_ROWS,
            request.cols ?: DEFAULT_COLS
        ) ?: throw BridgeException(ErrorCode.E_NO_RUNTIME, "native PTY is not available")

        val attachment = registry.attach(opened.sessionId, listener(sink), INITIAL_CREDIT)
            ?: throw BridgeException(ErrorCode.E_INTERNAL, "session disappeared during open")

        val reply = json.encodeToJsonElement(
            TermOpenReply.serializer(),
            TermOpenReply(opened.sessionId, opened.pid)
        )
        return OpenedSession(reply, attachment)
    }

    private fun listener(sink: StreamSink) = object : TerminalRegistry.Listener {
        override fun data(bytes: ByteArray) {
            sink.bytes("term.data", bytes)
        }

        override fun exit(code: Int) {
            sink.event(
                "term.exit",
                json.encodeToJsonElement(TermExit.serializer(), TermExit(code))
            )
        }
    }

    private fun attach(
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        val request = json.decodePayload(TermSessionRequest.serializer(), payload, "term.attach")
        val sessionId = request.sessionId
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "sessionId is required")

        val attachment = registry.attach(sessionId, listener(sink), INITIAL_CREDIT)
            ?: throw BridgeException(ErrorCode.E_NOT_FOUND, "no such session")

        val snapshot = attachment.snapshot
        respond(
            AsyncReply.Ok(
                json.encodeToJsonElement(
                    TermAttachReply.serializer(),
                    TermAttachReply(
                        sessionId = snapshot.sessionId,
                        scrollback = Base64.getEncoder().encodeToString(snapshot.scrollback),
                        alive = snapshot.alive,
                        exitCode = snapshot.exitCode
                    )
                )
            )
        )
        // Reply is queued on the main thread; live events posted from here land after it.
        attachment.start()
    }

    private fun list(): JsonElement {
        val infos = registry.list().map { info ->
            TermInfo(
                sessionId = info.sessionId,
                root = false,
                alive = info.alive,
                title = info.title,
                pid = info.pid,
                cwd = info.cwd
            )
        }
        return json.encodeToJsonElement(ListSerializer(TermInfo.serializer()), infos)
    }

    private fun write(payload: JsonObject): JsonElement {
        val request = json.decodePayload(TermWriteRequest.serializer(), payload, "term.write")
        val sessionId = request.sessionId
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "sessionId is required")
        val bytes = try {
            Base64.getDecoder().decode(request.b64 ?: "")
        } catch (e: IllegalArgumentException) {
            throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "invalid base64")
        }
        if (!registry.write(sessionId, bytes)) {
            throw BridgeException(ErrorCode.E_NOT_FOUND, "no such session")
        }
        return json.encodeToJsonElement(
            TermWriteReply.serializer(),
            TermWriteReply(bytes.size)
        )
    }

    private fun resize(payload: JsonObject): JsonElement {
        val request = json.decodePayload(TermResizeRequest.serializer(), payload, "term.resize")
        val sessionId = request.sessionId
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "sessionId is required")
        if (!registry.resize(sessionId, request.rows ?: DEFAULT_ROWS, request.cols ?: DEFAULT_COLS)) {
            throw BridgeException(ErrorCode.E_NOT_FOUND, "no such session")
        }
        return json.encodeToJsonElement(TermOk.serializer(), TermOk())
    }

    private fun closeSession(payload: JsonObject): JsonElement {
        val request = json.decodePayload(TermSessionRequest.serializer(), payload, "term.close")
        val sessionId = request.sessionId
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "sessionId is required")
        return json.encodeToJsonElement(
            TermCloseReply.serializer(),
            TermCloseReply(registry.close(sessionId))
        )
    }

    private fun ack(payload: JsonObject): JsonElement {
        val request = json.decodePayload(TermAckRequest.serializer(), payload, "term.ack")
        val sessionId = request.sessionId
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "sessionId is required")
        val bytes = request.bytes?.toLong()
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "bytes is required")
        if (bytes < 0) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "bytes must be positive")
        if (!registry.ack(sessionId, bytes)) {
            throw BridgeException(ErrorCode.E_NOT_FOUND, "no such session")
        }
        return json.encodeToJsonElement(TermOk.serializer(), TermOk())
    }

    private fun resolve(raw: String): File = try {
        jail.resolve(raw, workspace.defaultWorkspace)
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "path is outside the allowed roots")
    }
}
