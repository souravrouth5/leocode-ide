package dev.leocode.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * `saf.*` and `storage.*`, `docs/bridge-contract.md`.
 *
 * Everything except `storage.info` waits on the user, so all four methods reply
 * asynchronously through [AsyncReply]. Cancelling a picker is a normal `null`
 * reply, not an error. Content is capped at 4 MB for both directions.
 */
class SafHandler(
    private val port: SafPort,
    private val json: Json = Json { ignoreUnknownKeys = true }
) : AsyncBridgeHandler {

    companion object {
        private val METHODS =
            setOf("saf.open", "saf.save", "storage.info", "storage.requestPermission")
        private const val MAX_WRITE_BYTES = 4 * 1024 * 1024
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(
        method: String,
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        when (method) {
            "storage.info" -> respond(
                AsyncReply.Ok(
                    json.encodeToJsonElement(StorageInfo.serializer(), port.storageInfo())
                )
            )

            "storage.requestPermission" -> port.requestStoragePermission { granted ->
                respond(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            StoragePermissionReply.serializer(),
                            StoragePermissionReply(granted)
                        )
                    )
                )
            }

            "saf.open" -> {
                val request = json.decodePayload(SafOpenRequest.serializer(), payload, method)
                port.openDocument(request.mime ?: "*/*") { result ->
                    val error = result.exceptionOrNull()
                    if (error != null) {
                        respond(AsyncReply.Error(safError(error), safMessage(error)))
                        return@openDocument
                    }
                    val document = result.getOrNull()
                    when {
                        document == null -> respond(AsyncReply.Ok(JsonNull))
                        document.size > MAX_WRITE_BYTES -> respond(
                            AsyncReply.Error(ErrorCode.E_LIMIT, "file is larger than 4 MB")
                        )
                        else -> respond(
                            AsyncReply.Ok(
                                json.encodeToJsonElement(
                                    SafOpenReply.serializer(),
                                    SafOpenReply(
                                        document.name,
                                        document.uri,
                                        document.content,
                                        document.size
                                    )
                                )
                            )
                        )
                    }
                }
            }

            "saf.save" -> {
                val request = json.decodePayload(SafSaveRequest.serializer(), payload, method)
                val name = request.name ?: "document.txt"
                val content = request.content ?: ""
                val size = content.toByteArray(Charsets.UTF_8).size
                if (size > MAX_WRITE_BYTES) {
                    throw BridgeException(ErrorCode.E_LIMIT, "content is larger than 4 MB")
                }
                port.saveDocument(name, content) { result ->
                    val error = result.exceptionOrNull()
                    if (error != null) {
                        respond(AsyncReply.Error(safError(error), safMessage(error)))
                        return@saveDocument
                    }
                    val uri = result.getOrNull()
                    respond(
                        AsyncReply.Ok(
                            if (uri == null) {
                                JsonNull
                            } else {
                                json.encodeToJsonElement(
                                    SafSaveReply.serializer(),
                                    SafSaveReply(name, uri)
                                )
                            }
                        )
                    )
                }
            }

            else -> throw BridgeException(
                ErrorCode.E_UNKNOWN_METHOD,
                "unknown method: $method"
            )
        }
    }

    /** Fixed copy: never put provider paths or exception text on the wire (B-06). */
    private fun safError(error: Throwable): ErrorCode = when (error) {
        is SecurityException -> ErrorCode.E_PERMISSION
        is java.io.FileNotFoundException -> ErrorCode.E_NOT_FOUND
        else -> ErrorCode.E_IO
    }

    private fun safMessage(error: Throwable): String = when (safError(error)) {
        ErrorCode.E_PERMISSION -> "the document provider denied access"
        ErrorCode.E_NOT_FOUND -> "the selected document is no longer available"
        else -> "the document could not be read or written"
    }
}
