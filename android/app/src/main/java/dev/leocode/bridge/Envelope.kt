package dev.leocode.bridge

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Bridge envelope DTOs, `docs/bridge-contract.md`.
 *
 * `id` stays a raw [JsonElement] so replies echo the request id byte-for-byte
 * (the web client uses strings; older callers used numbers).
 */
@Serializable
data class BridgeRequest(
    val v: Int = 1,
    val id: JsonElement? = null,
    val method: String,
    val payload: JsonObject = JsonObject(emptyMap())
)

@Serializable
data class BridgeErrorBody(
    val code: String,
    val message: String,
    val correlationId: String? = null
)

/** Decode a handler payload, mapping schema failures to [ErrorCode.E_BAD_ENVELOPE]. */
internal fun <T> Json.decodePayload(
    deserializer: DeserializationStrategy<T>,
    payload: JsonObject,
    method: String
): T = try {
    decodeFromJsonElement(deserializer, payload)
} catch (e: SerializationException) {
    throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "invalid payload for $method")
} catch (e: IllegalArgumentException) {
    throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "invalid payload for $method")
}
