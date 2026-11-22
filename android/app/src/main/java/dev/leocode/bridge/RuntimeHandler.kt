package dev.leocode.bridge

import android.content.Context
import dev.leocode.core.Redactor
import dev.leocode.core.RuntimeInstallException
import dev.leocode.core.RuntimeInstaller
import dev.leocode.core.Workspace
import java.io.Closeable
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * `runtime.*`, `docs/bridge-contract.md` (Task 25).
 *
 * `runtime.install` and `runtime.repair` answer as soon as the job is accepted,
 * then stream `runtime.progress` and finish with one `runtime.result` event. The
 * reply no longer waits for the download, so the 10 s bridge timeout does not
 * apply to a slow install. Ids are locked with `E_BUSY` while a job runs.
 */
class RuntimeHandler(
    context: Context,
    private val workspace: Workspace,
    private val json: Json = BridgeJson.value,
    private val log: (String) -> Unit = {}
) : AsyncBridgeHandler, Closeable {

    companion object {
        private val METHODS = setOf(
            "runtime.catalog",
            "runtime.install",
            "runtime.cancel",
            "runtime.uninstall",
            "runtime.repair"
        )
        private fun correlationId(): String =
            "c-" + UUID.randomUUID().toString().replace("-", "").take(6)
    }

    private val installer = RuntimeInstaller(context.applicationContext, workspace)
    private val jobs = ConcurrentHashMap<String, AtomicBoolean>()
    private val io = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "leocode-runtime").apply { isDaemon = true }
    }

    override fun methods(): Set<String> = METHODS

    /** Catalog entries for diagnostics; the install methods map the same data. */
    fun catalog(): List<RuntimeCatalogEntry> = installer.catalog().map {
        RuntimeCatalogEntry(
            it.id,
            it.version,
            it.versionCode,
            it.installed,
            it.healthy,
            it.installedVersionCode
        )
    }

    override fun handle(
        method: String,
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        when (method) {
            "runtime.catalog" -> respond(
                AsyncReply.Ok(
                    json.encodeToJsonElement(
                        ListSerializer(RuntimeCatalogEntry.serializer()),
                        catalog()
                    )
                )
            )

            "runtime.install" -> start(payload, respond, sink, repair = false)
            "runtime.repair" -> start(payload, respond, sink, repair = true)
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

            "runtime.uninstall" -> uninstall(payload, respond)

            else -> throw BridgeException(
                ErrorCode.E_UNKNOWN_METHOD,
                "unknown method: $method"
            )
        }
    }

    private fun start(
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink,
        repair: Boolean
    ) {
        val method = if (repair) "runtime.repair" else "runtime.install"
        val request = json.decodePayload(RuntimeInstallRequest.serializer(), payload, method)
        val runtimeId = request.id
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "id is required")
        val cancelled = AtomicBoolean(false)
        if (jobs.putIfAbsent(runtimeId, cancelled) != null) {
            throw BridgeException(ErrorCode.E_BUSY, "$runtimeId is already being installed")
        }

        // Accept the job before the slow work so the reply fits the contract.
        respond(
            AsyncReply.Ok(
                json.encodeToJsonElement(
                    RuntimeInstallReply.serializer(),
                    RuntimeInstallReply(runtimeId, true)
                )
            )
        )

        io.execute {
            val progress: (RuntimeInstaller.Progress) -> Unit = { item ->
                sink.event(
                    "runtime.progress",
                    json.encodeToJsonElement(
                        RuntimeProgress.serializer(),
                        RuntimeProgress(item.phase, item.bytes, item.total, item.message)
                    )
                )
            }
            val result = try {
                if (repair) {
                    installer.repair(runtimeId, progress, cancelled::get)
                } else {
                    installer.install(runtimeId, progress, cancelled::get)
                }
                RuntimeResult(runtimeId, ok = true)
            } catch (e: RuntimeInstallException) {
                // Never forward installer text: it contains absolute app paths
                // and archive entry names (B-06). The detail goes to a redacted
                // log with a correlation id the sheet can show.
                val id = correlationId()
                log("$method $runtimeId $id ${e.code}: ${Redactor.redact(e.message ?: "")}")
                RuntimeResult(runtimeId, ok = false, code = e.code, message = safeMessage(e.code))
            } catch (e: Throwable) {
                val id = correlationId()
                log(
                    "$method $runtimeId $id ${e.javaClass.name}: " +
                        Redactor.redact(e.message ?: "")
                )
                RuntimeResult(
                    runtimeId,
                    ok = false,
                    code = "E_INTERNAL",
                    message = "the runtime could not be installed"
                )
            } finally {
                jobs.remove(runtimeId)
            }
            sink.event(
                "runtime.result",
                json.encodeToJsonElement(RuntimeResult.serializer(), result)
            )
        }
    }

    private fun uninstall(payload: JsonObject, respond: (AsyncReply) -> Unit) {
        val request = json.decodePayload(
            RuntimeInstallRequest.serializer(),
            payload,
            "runtime.uninstall"
        )
        val runtimeId = request.id
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "id is required")
        io.execute {
            val reply = try {
                installer.uninstall(runtimeId)
                AsyncReply.Ok(JsonObject(emptyMap()))
            } catch (e: RuntimeInstallException) {
                val id = correlationId()
                log("runtime.uninstall $runtimeId $id ${e.code}: ${Redactor.redact(e.message ?: "")}")
                AsyncReply.Error(ErrorCode.fromCode(e.code), safeMessage(e.code), id)
            } catch (e: Throwable) {
                val id = correlationId()
                log(
                    "runtime.uninstall $runtimeId $id ${e.javaClass.name}: " +
                        Redactor.redact(e.message ?: "")
                )
                AsyncReply.Error(ErrorCode.E_INTERNAL, "the runtime could not be removed", id)
            }
            respond(reply)
        }
    }

    /** Fixed user-facing copy for installer failures (B-06). */
    private fun safeMessage(code: String): String = when (code) {
        "E_BAD_MANIFEST" -> "the runtime package manifest is not valid"
        "E_INTEGRITY" -> "the runtime package failed its integrity check"
        "E_HEALTH_CHECK" -> "the runtime did not start correctly after installing"
        "E_OFFLINE" -> "the download needs a network connection"
        "E_DISK_FULL" -> "there is not enough free space for this runtime"
        "E_CANCELLED" -> "the installation was cancelled"
        "E_PERMISSION" -> "Android denied access to the install location"
        "E_NOT_FOUND" -> "that runtime is not installed"
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
