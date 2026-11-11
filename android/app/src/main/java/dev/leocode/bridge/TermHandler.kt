package dev.leocode.bridge

import dev.leocode.core.ChildEnv
import dev.leocode.core.PathJail
import dev.leocode.core.PtySession
import dev.leocode.core.Workspace
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.Closeable
import java.io.File
import java.util.Base64
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * `term.*`, `docs/bridge-contract.md`.
 *
 * The reader stops when its 256 KB credit is exhausted; `term.ack` grants more.
 * That is the backpressure that keeps `yes` from flooding the WebView. Reads are
 * capped at 32 KB each and the request sink coalesces them at ~16 ms.
 */
class TermHandler(
    private val workspace: Workspace,
    private val jail: PathJail,
    private val childEnv: Map<String, String>
) : StreamingBridgeHandler, Closeable {

    companion object {
        val METHODS = setOf("term.open", "term.write", "term.resize", "term.close", "term.ack")
        private const val DEFAULT_COLS = 80
        private const val DEFAULT_ROWS = 24
        private const val INITIAL_CREDIT = 256L * 1024
        private const val MAX_CREDIT = 4L * 1024 * 1024
        private const val MAX_READ = 32 * 1024
    }

    private val sessions = ConcurrentHashMap<String, Session>()

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "term.open" -> open(payload, NoopStreamSink)
        "term.write" -> write(payload)
        "term.resize" -> resize(payload)
        "term.close" -> closeSession(payload)
        "term.ack" -> ack(payload)
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    /** `term.open` needs a sink, so the router uses [StreamingBridgeHandler]. */
    override fun handle(method: String, payload: JsonObject, sink: StreamSink): JsonElement = when (method) {
        "term.open" -> open(payload, sink)
        else -> handle(method, payload)
    }

    override fun close() {
        sessions.keys.toList().forEach { id ->
            sessions.remove(id)?.close()
        }
    }

    private fun open(payload: JsonObject, sink: StreamSink): JsonObject {
        val cwd = resolve(payload["cwd"]?.jsonContent() ?: ".")
        if (!cwd.isDirectory) throw BridgeException(ErrorCode.E_NOT_DIR, "cwd is not a directory")

        val cols = payload.int("cols") ?: DEFAULT_COLS
        val rows = payload.int("rows") ?: DEFAULT_ROWS

        val pty = PtySession.openShell(
            cwd.absolutePath,
            ChildEnv.build(childEnv) + ("PWD" to cwd.absolutePath),
            rows,
            cols
        ) ?: throw BridgeException(ErrorCode.E_NO_RUNTIME, "native PTY is not available")

        val sessionId = UUID.randomUUID().toString()
        val session = Session(sessionId, pty)
        sessions[sessionId] = session
        thread(isDaemon = true, name = "leocode-term-$sessionId") {
            pump(session, sink)
        }

        return buildJsonObject {
            put("sessionId", sessionId)
            put("pid", pty.pid)
        }
    }

    private fun write(payload: JsonObject): JsonObject {
        val session = session(payload)
        val bytes = try {
            Base64.getDecoder().decode(payload.str("b64") ?: "")
        } catch (e: IllegalArgumentException) {
            throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "invalid base64")
        }
        if (bytes.isEmpty()) return buildJsonObject { put("accepted", 0) }
        if (session.write(bytes) < 0) {
            throw BridgeException(ErrorCode.E_NOT_FOUND, "no such session")
        }
        return buildJsonObject { put("accepted", bytes.size) }
    }

    private fun resize(payload: JsonObject): JsonObject {
        val session = session(payload)
        val rows = payload.int("rows") ?: DEFAULT_ROWS
        val cols = payload.int("cols") ?: DEFAULT_COLS
        if (!session.resize(rows, cols)) {
            throw BridgeException(ErrorCode.E_NOT_FOUND, "no such session")
        }
        return buildJsonObject { put("ok", true) }
    }

    private fun closeSession(payload: JsonObject): JsonObject {
        val sessionId = payload["sessionId"]?.jsonContent()
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "sessionId is required")
        val session = sessions.remove(sessionId)
        session?.close()
        return buildJsonObject { put("closed", session != null) }
    }

    private fun ack(payload: JsonObject): JsonObject {
        val session = session(payload)
        val bytes = (payload["bytes"] as? JsonPrimitive)?.longOrNull
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "bytes is required")
        if (bytes < 0) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "bytes must be positive")
        if (!session.ack(bytes)) {
            throw BridgeException(ErrorCode.E_NOT_FOUND, "no such session")
        }
        return buildJsonObject { put("ok", true) }
    }

    private fun pump(session: Session, sink: StreamSink) {
        try {
            while (true) {
                val want = session.reserve(MAX_READ)
                if (want <= 0) break
                val chunk = try {
                    session.read(want)
                } catch (_: Throwable) {
                    null
                }
                if (chunk == null) {
                    session.release(want)
                    break
                }
                if (chunk.isEmpty()) {
                    session.release(want)
                    continue
                }
                if (chunk.size < want) session.release(want - chunk.size)
                sink.bytes("term.data", chunk)
            }
        } finally {
            val code = runCatching { session.pty.waitFor() }.getOrDefault(-1)
            val removed = sessions.remove(session.id) == session
            session.close()
            if (removed) {
                sink.event("term.exit", buildJsonObject { put("code", code) })
            }
        }
    }

    private fun session(payload: JsonObject): Session {
        val sessionId = payload["sessionId"]?.jsonContent()
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "sessionId is required")
        return sessions[sessionId]
            ?: throw BridgeException(ErrorCode.E_NOT_FOUND, "no such session")
    }

    private fun resolve(raw: String): File = try {
        jail.resolve(raw, workspace.defaultWorkspace)
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "path is outside the allowed roots")
    }

    private fun JsonObject.str(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull

    private fun JsonObject.int(key: String): Int? =
        (this[key] as? JsonPrimitive)?.intOrNull

    private fun JsonElement.jsonContent(): String? =
        (this as? JsonPrimitive)?.contentOrNull

    private class Session(val id: String, val pty: PtySession) {
        private val lock = Object()
        private var credit = INITIAL_CREDIT
        private var closed = false

        /** Blocks while credit is exhausted; returns the number of bytes reserved. */
        fun reserve(max: Int): Int {
            synchronized(lock) {
                while (!closed && credit <= 0) {
                    try {
                        lock.wait()
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return 0
                    }
                }
                if (closed) return 0
                val want = minOf(credit, max.toLong()).toInt()
                credit -= want
                return want
            }
        }

        /** Give back reserved-but-unused credit. */
        fun release(bytes: Int) {
            if (bytes <= 0) return
            synchronized(lock) {
                if (!closed) credit = minOf(MAX_CREDIT, credit + bytes)
            }
        }

        fun ack(bytes: Long): Boolean {
            synchronized(lock) {
                if (closed) return false
                credit = minOf(MAX_CREDIT, credit + bytes.coerceAtMost(MAX_CREDIT))
                lock.notifyAll()
                return true
            }
        }

        fun read(max: Int): ByteArray? = pty.readBlocking(max)

        fun write(bytes: ByteArray): Int = synchronized(lock) {
            if (closed) -1 else pty.write(bytes)
        }

        fun resize(rows: Int, cols: Int): Boolean = synchronized(lock) {
            if (closed) {
                false
            } else {
                pty.resize(rows, cols)
                true
            }
        }

        fun close() {
            val wasOpen = synchronized(lock) {
                val previous = !closed
                closed = true
                lock.notifyAll()
                previous
            }
            if (wasOpen) pty.destroy()
        }
    }
}
