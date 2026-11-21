package dev.leocode.bridge

import kotlinx.serialization.DeserializationStrategy
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

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

/**
 * Envelope id parsing that cannot throw on hostile input (B-01).
 *
 * `jsonPrimitive` throws for objects and arrays; the host used to call it on the
 * main thread before any guard. `id` accepts strings and numbers, returned as
 * the string form the router echoes; anything else is rejected.
 */
object SafeEnvelope {
    fun idElement(request: JsonObject): JsonElement? = request["id"]

    fun isValidId(element: JsonElement?): Boolean =
        element == null || element is JsonNull || element is JsonPrimitive

    fun id(request: JsonObject): String? {
        val element = request["id"] ?: return null
        if (element is JsonNull) return null
        return (element as? JsonPrimitive)?.contentOrNull
    }
}

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
