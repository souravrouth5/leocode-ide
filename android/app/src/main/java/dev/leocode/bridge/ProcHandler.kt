package dev.leocode.bridge

import dev.leocode.core.ChildEnv
import dev.leocode.core.PathJail
import dev.leocode.core.ProcessSupervisor
import dev.leocode.core.Workspace
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
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
    private val supervisor: ProcessSupervisor,
    private val activeRoot: () -> File = { workspace.defaultWorkspace },
    private val json: Json = BridgeJson.value,
    private val rootManager: dev.leocode.core.RootManager? = null
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

    private fun run(payload: JsonObject, sink: StreamSink): JsonElement {
        val request = json.decodePayload(ProcRunRequest.serializer(), payload, "proc.run")
        if (request.argv.isEmpty()) {
            throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "argv is empty")
        }

        val cwd = resolve(request.cwd ?: ".")
        if (!cwd.isDirectory) throw BridgeException(ErrorCode.E_NOT_DIR, "cwd is not a directory")

        if (request.root) {
            if (rootManager == null || !rootManager.isAvailable()) {
                throw BridgeException(ErrorCode.E_ROOT_UNAVAILABLE, "root is not available")
            }
            if (!rootManager.canUseRoot()) {
                throw BridgeException(ErrorCode.E_ROOT_DENIED, "root mode is not enabled")
            }
        }

        val spec = ProcessSupervisor.Spec(
            argv = request.argv,
            cwd = cwd,
            env = ChildEnv.build(emptyMap(), request.env),
            timeoutMs = request.timeoutMs?.takeIf { it > 0 } ?: DEFAULT_TIMEOUT_MS,
            root = request.root
        )

        val handle = try {
            supervisor.start(
                spec,
                // Coalesce at 16 ms like terminal output (B-08); the event
                // payload shape is the same `{ data }`.
                onStdout = { text -> sink.text("proc.stdout", text) },
                onStderr = { text -> sink.text("proc.stderr", text) },
                onExit = { code ->
                    sink.event(
                        "proc.exit",
                        json.encodeToJsonElement(ProcExit.serializer(), ProcExit(code))
                    )
                },
                onRootLost = { event ->
                    sink.event(
                        "root.lost",
                        json.encodeToJsonElement(RootLostEvent.serializer(), event)
                    )
                }
            )
        } catch (e: Exception) {
            throw BridgeException(ErrorCode.E_IO, "cannot start ${request.argv.first()}")
        }

        return json.encodeToJsonElement(
            ProcRunReply.serializer(),
            ProcRunReply(handle.jobId, handle.pid)
        )
    }

    private fun cancel(payload: JsonObject): JsonElement {
        val request = json.decodePayload(ProcCancelRequest.serializer(), payload, "proc.cancel")
        val jobId = request.jobId
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "jobId is required")
        return json.encodeToJsonElement(
            ProcCancelReply.serializer(),
            ProcCancelReply(supervisor.cancel(jobId))
        )
    }

    private fun resolve(raw: String): File = try {
        // A relative cwd belongs to the active workspace, not the default one;
        // Run in a non-default project otherwise executes from the wrong tree.
        jail.resolve(raw, activeRoot())
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "path is outside the allowed roots")
    }
}
