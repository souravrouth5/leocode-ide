package dev.leocode.bridge

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Theme state as the `app.theme.*` methods see it. The Android implementation
 * lives in the Activity (ThemeManager); tests use a plain fake.
 */
interface ThemePort {
    fun state(): JsonObject
    fun setMode(mode: String?): JsonObject
}

/** `app.ping`, `app.info`, `app.theme.get`, `app.theme.set`. */
class AppHandler(
    private val theme: ThemePort,
    private val appInfo: () -> JsonObject,
    private val json: Json = Json { ignoreUnknownKeys = true }
) : BridgeHandler {

    companion object {
        val METHODS = setOf("app.ping", "app.info", "app.theme.get", "app.theme.set")
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "app.ping" -> buildJsonObject { put("pong", true) }
        "app.info" -> appInfo()
        "app.theme.get" -> theme.state()
        "app.theme.set" -> {
            val request = json.decodePayload(ThemeSetRequest.serializer(), payload, method)
            theme.setMode(request.mode)
        }
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    @Serializable
    private data class ThemeSetRequest(val mode: String? = null)
}
