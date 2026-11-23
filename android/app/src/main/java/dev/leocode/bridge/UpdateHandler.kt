package dev.leocode.bridge

import dev.leocode.core.Redactor
import dev.leocode.core.UpdateChecker
import dev.leocode.core.UpdateException
import dev.leocode.core.UpdateInstaller
import java.io.Closeable
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * `update.check` / `update.install` / `update.cancel` (Task 28).
 *
 * `update.check` fetches and verifies the signed manifest on a worker thread.
 * `update.install` answers as soon as the job is accepted, streams
 * `update.progress` and finishes with one `update.result`; the system installer
 * is then a visible Android prompt, never a silent install.
 */
class UpdateHandler(
    private val checker: UpdateChecker,
    private val installer: UpdateInstaller,
    private val json: Json = BridgeJson.value,
    private val log: (String) -> Unit = {}
) : AsyncBridgeHandler, Closeable {

    companion object {
        private val METHODS = setOf("update.check", "update.install", "update.cancel")

        private fun correlationId(): String =
            "u-" + UUID.randomUUID().toString().replace("-", "").take(6)
    }

    private val io = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "leocode-update").apply { isDaemon = true }
    }
    private val busy = AtomicBoolean(false)
    private val cancelled = AtomicBoolean(false)

    override fun methods(): Set<String> = METHODS

    override fun handle(
        method: String,
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        when (method) {
            "update.check" -> check(respond)
            "update.install" -> install(payload, respond, sink)
            "update.cancel" -> {
                val wasBusy = busy.get()
                cancelled.set(true)
                respond(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            UpdateCancelReply.serializer(),
                            UpdateCancelReply(wasBusy)
                        )
                    )
                )
            }
            else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
        }
    }

    private fun check(respond: (AsyncReply) -> Unit) {
        io.execute {
            val reply = try {
                val info = checker.check()
                val manifest = info.manifest
                AsyncReply.Ok(
                    json.encodeToJsonElement(
                        UpdateCheckReply.serializer(),
                        UpdateCheckReply(
                            available = info.available,
                            currentVersion = info.currentVersion,
                            versionName = manifest?.versionName,
                            versionCode = manifest?.versionCode,
                            notes = manifest?.notes,
                            url = manifest?.apkUrl,
                            sha256 = manifest?.apkSha256,
                            size = manifest?.apkSize
                        )
                    )
                )
            } catch (e: UpdateException) {
                val id = correlationId()
                log("update.check $id ${e.code}: ${Redactor.redact(e.message)}")
                AsyncReply.Error(ErrorCode.fromCode(e.code), safeMessage(e.code), id)
            } catch (e: Throwable) {
                val id = correlationId()
                log("update.check $id ${e.javaClass.name}: ${Redactor.redact(e.message ?: "")}")
                AsyncReply.Error(ErrorCode.E_INTERNAL, "the update check failed", id)
            }
            respond(reply)
        }
    }

    private fun install(
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        val request = json.decodePayload(UpdateInstallRequest.serializer(), payload, "update.install")
        if (!busy.compareAndSet(false, true)) {
            throw BridgeException(ErrorCode.E_BUSY, "an update is already downloading")
        }
        cancelled.set(false)

        respond(
            AsyncReply.Ok(
                json.encodeToJsonElement(
                    UpdateInstallReply.serializer(),
                    UpdateInstallReply(started = true)
                )
            )
        )

        io.execute {
            val result = try {
                installer.downloadAndInstall(
                    request.url,
                    request.sha256,
                    request.size,
                    request.versionCode,
                    { progress ->
                        sink.event(
                            "update.progress",
                            json.encodeToJsonElement(
                                UpdateProgress.serializer(),
                                UpdateProgress(progress.phase, progress.bytes, progress.total)
                            )
                        )
                    },
                    cancelled::get
                )
                UpdateResult(ok = true)
            } catch (e: UpdateException) {
                val id = correlationId()
                log("update.install $id ${e.code}: ${Redactor.redact(e.message)}")
                UpdateResult(ok = false, code = e.code, message = safeMessage(e.code))
            } catch (e: Throwable) {
                val id = correlationId()
                log("update.install $id ${e.javaClass.name}: ${Redactor.redact(e.message ?: "")}")
                UpdateResult(ok = false, code = "E_INTERNAL", message = "the update could not be installed")
            } finally {
                busy.set(false)
            }
            sink.event(
                "update.result",
                json.encodeToJsonElement(UpdateResult.serializer(), result)
            )
        }
    }

    /** Fixed user-facing copy; installer detail stays in the redacted log. */
    private fun safeMessage(code: String): String = when (code) {
        "E_BAD_MANIFEST" -> "the update manifest is not valid or not signed for this app"
        "E_INTEGRITY" -> "the update failed its integrity or signature check"
        "E_OFFLINE" -> "the update server could not be reached"
        "E_DISK_FULL" -> "there is not enough free space for this update"
        "E_PERMISSION" -> "allow LeoCode to install unknown apps, then try again"
        "E_UNSUPPORTED" -> "this update is not supported on this Android version"
        "E_CANCELLED" -> "the update was cancelled"
        else -> "the update could not be installed"
    }

    /** Idle daemon threads retire on their own; a running download sees the flag. */
    override fun close() {
        cancelled.set(true)
    }
}
