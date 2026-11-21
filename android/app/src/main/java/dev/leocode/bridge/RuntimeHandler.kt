package dev.leocode.bridge

import android.content.Context
import dev.leocode.core.Redactor
import dev.leocode.core.RuntimeInstallException
import dev.leocode.core.RuntimeInstaller
import dev.leocode.core.Workspace
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import java.io.Closeable
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * `runtime.install` / `runtime.cancel`, `docs/bridge-contract.md`.
 *
 * An install streams `runtime.progress` and replies once when it finishes, so
 * the handler is async. Ids are locked with `E_BUSY` while installing; a cancel
 * only flips the flag the installer polls between chunks.
 */
class RuntimeHandler(
    context: Context,
    private val workspace: Workspace,
    private val json: Json = BridgeJson.value,
    private val log: (String) -> Unit = {}
) : AsyncBridgeHandler, Closeable {

    companion object {
        private val METHODS = setOf("runtime.install", "runtime.cancel")
        private fun correlationId(): String =
            "c-" + UUID.randomUUID().toString().replace("-", "").take(6)
    }

    private val installer = RuntimeInstaller(context.applicationContext, workspace)
    private val jobs = ConcurrentHashMap<String, AtomicBoolean>()
    private val io = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "leocode-runtime").apply { isDaemon = true }
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(
        method: String,
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        when (method) {
            "runtime.install" -> install(payload, respond, sink)
            "runtime.cancel" -> {
                val request =
                    json.decodePayload(RuntimeCancelRequest.serializer(), payload, method)
                val id = request.id
                    ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "id is required")
                val flag = jobs[id]
                flag?.set(true)
                respond(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            RuntimeCancelReply.serializer(),
                            RuntimeCancelReply(flag != null)
                        )
                    )
                )
            }

            else -> throw BridgeException(
                ErrorCode.E_UNKNOWN_METHOD,
                "unknown method: $method"
            )
        }
    }

    private fun install(
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        val request = json.decodePayload(RuntimeInstallRequest.serializer(), payload, "runtime.install")
        val runtimeId = request.id
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "id is required")
        val cancelled = AtomicBoolean(false)
        if (jobs.putIfAbsent(runtimeId, cancelled) != null) {
            throw BridgeException(ErrorCode.E_BUSY, "$runtimeId is already being installed")
        }

        io.execute {
            val reply = try {
                installer.install(
                    runtimeId,
                    onProgress = { progress ->
                        sink.event(
                            "runtime.progress",
                            json.encodeToJsonElement(
                                RuntimeProgress.serializer(),
                                RuntimeProgress(
                                    progress.phase,
                                    progress.bytes,
                                    progress.total,
                                    progress.message
                                )
                            )
                        )
                    },
                    isCancelled = { cancelled.get() }
                )
                AsyncReply.Ok(
                    json.encodeToJsonElement(
                        RuntimeInstallReply.serializer(),
                        RuntimeInstallReply(runtimeId, true)
                    )
                )
            } catch (e: RuntimeInstallException) {
                // Never forward installer text: it contains absolute app paths
                // and archive entry names (B-06). The detail goes to a redacted
                // log with a correlation id the sheet can show.
                val id = correlationId()
                log("runtime.install $runtimeId $id ${e.code}: ${Redactor.redact(e.message ?: "")}")
                AsyncReply.Error(
                    ErrorCode.fromCode(e.code),
                    safeMessage(e.code),
                    id
                )
            } catch (e: Throwable) {
                val id = correlationId()
                log(
                    "runtime.install $runtimeId $id ${e.javaClass.name}: " +
                        Redactor.redact(e.message ?: "")
                )
                AsyncReply.Error(ErrorCode.E_INTERNAL, "the runtime could not be installed", id)
            } finally {
                // Remove before replying so a cancel sent right after the reply
                // does not find a stale job that is already gone.
                jobs.remove(runtimeId)
            }
            respond(reply)
        }
    }

    /** Fixed user-facing copy for installer failures (B-06). */
    private fun safeMessage(code: String): String = when (code) {
        "E_BAD_MANIFEST" -> "the runtime package manifest is not valid"
        "E_INTEGRITY" -> "the download failed its integrity check"
        "E_HEALTH_CHECK" -> "the runtime did not start correctly after installing"
        "E_OFFLINE" -> "the download needs a network connection"
        "E_DISK_FULL" -> "there is not enough free space for this runtime"
        "E_CANCELLED" -> "the installation was cancelled"
        "E_PERMISSION" -> "Android denied access to the install location"
        else -> "the runtime could not be installed"
    }

    /**
     * Ask running installs to stop. The worker pool is process-wide (the graph
     * outlives the Activity), so it is not shut down here; idle daemon threads
     * retire on their own.
     */
    override fun close() {
        jobs.values.forEach { it.set(true) }
    }
}
