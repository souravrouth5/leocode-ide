package dev.leocode.bridge

import dev.leocode.core.ChildEnv
import dev.leocode.core.PathJail
import dev.leocode.core.ProcessSupervisor
import dev.leocode.core.Workspace
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.io.Closeable
import java.io.File

/**
 * `proc.run` and `proc.cancel`, `docs/bridge-contract.md`.
 *
 * Paths go through [PathJail]; child environments go through [ChildEnv]. Output
 * and the final exit event are streamed through the request [StreamSink].
 */
class ProcHandler(
    private val workspace: Workspace,
    private val jail: PathJail,
    private val supervisor: ProcessSupervisor
) : StreamingBridgeHandler, Closeable {

    companion object {
        val METHODS = setOf("proc.run", "proc.cancel")
        // No default timeout: a Run action may legitimately be a long server.
        private const val DEFAULT_TIMEOUT_MS = 0L
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement =
        handle(method, payload, NoopStreamSink)

    override fun handle(method: String, payload: JsonObject, sink: StreamSink): JsonElement =
        when (method) {
            "proc.run" -> run(payload, sink)
            "proc.cancel" -> cancel(payload)
            else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
        }

    override fun close() {
        supervisor.close()
    }

    private fun run(payload: JsonObject, sink: StreamSink): JsonObject {
        val array = payload["argv"] as? JsonArray
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "argv is required")
        if (array.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "argv is empty")
        val argv = array.map { element ->
            val primitive = element as? JsonPrimitive
            if (primitive == null || !primitive.isString) {
                throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "argv must be strings")
            }
            primitive.content
        }

        val cwd = resolve(payload["cwd"]?.jsonContent() ?: ".")
        if (!cwd.isDirectory) throw BridgeException(ErrorCode.E_NOT_DIR, "cwd is not a directory")

        val extra = mutableMapOf<String, String>()
        (payload["env"] as? JsonObject)?.forEach { (key, value) ->
            (value as? JsonPrimitive)?.contentOrNull?.let { extra[key] = it }
        }

        val timeoutMs = (payload["timeoutMs"] as? JsonPrimitive)
            ?.longOrNull
            ?.takeIf { it > 0 }
            ?: DEFAULT_TIMEOUT_MS

        val spec = ProcessSupervisor.Spec(
            argv = argv,
            cwd = cwd,
            env = ChildEnv.build(emptyMap(), extra),
            timeoutMs = timeoutMs
        )

        val handle = try {
            supervisor.start(
                spec,
                onStdout = { text -> sink.text("proc.stdout", text) },
                onStderr = { text -> sink.text("proc.stderr", text) },
                onExit = { code -> sink.event("proc.exit", buildJsonObject { put("code", code) }) }
            )
        } catch (e: Exception) {
            throw BridgeException(ErrorCode.E_IO, "cannot start ${argv.first()}")
        }

        return buildJsonObject {
            put("jobId", handle.jobId)
            put("pid", handle.pid)
        }
    }

    private fun cancel(payload: JsonObject): JsonObject {
        val jobId = payload["jobId"]?.jsonContent()
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "jobId is required")
        return buildJsonObject { put("cancelled", supervisor.cancel(jobId)) }
    }

    private fun resolve(raw: String): File = try {
        jail.resolve(raw, workspace.defaultWorkspace)
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "path is outside the allowed roots")
    }

    private fun JsonElement.jsonContent(): String? =
        (this as? JsonPrimitive)?.contentOrNull
}
