package dev.leocode.bridge

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * `saf.*` and `storage.*`, `docs/bridge-contract.md`.
 *
 * Everything except `storage.info` waits on the user, so all four methods reply
 * asynchronously through [AsyncReply]. Cancelling a picker is a normal `null`
 * reply, not an error. Content is capped at 4 MB for both directions.
 */
class SafHandler(private val port: SafPort) : AsyncBridgeHandler {

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
            "storage.info" -> respond(AsyncReply.Ok(port.storageInfo()))

            "storage.requestPermission" -> port.requestStoragePermission { granted ->
                respond(AsyncReply.Ok(buildJsonObject { put("granted", granted) }))
            }

            "saf.open" -> {
                val mime = payload.str("mime") ?: "*/*"
                port.openDocument(mime) { document ->
                    when {
                        document == null -> respond(AsyncReply.Ok(JsonNull))
                        document.size > MAX_WRITE_BYTES -> respond(
                            AsyncReply.Error(ErrorCode.E_LIMIT, "file is larger than 4 MB")
                        )
                        else -> respond(
                            AsyncReply.Ok(
                                buildJsonObject {
                                    put("name", document.name)
                                    put("uri", document.uri)
                                    put("content", document.content)
                                    put("size", document.size)
                                }
                            )
                        )
                    }
                }
            }

            "saf.save" -> {
                val name = payload.str("name") ?: "document.txt"
                val content = payload.str("content") ?: ""
                val size = content.toByteArray(Charsets.UTF_8).size
                if (size > MAX_WRITE_BYTES) {
                    throw BridgeException(ErrorCode.E_LIMIT, "content is larger than 4 MB")
                }
                port.saveDocument(name, content) { uri ->
                    respond(
                        AsyncReply.Ok(
                            if (uri == null) {
                                JsonNull
                            } else {
                                buildJsonObject {
                                    put("name", name)
                                    put("uri", uri)
                                }
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

    private fun JsonObject.str(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull
}
