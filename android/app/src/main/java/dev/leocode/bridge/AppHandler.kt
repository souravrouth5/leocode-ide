package dev.leocode.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Theme state as the `app.theme.*` methods see it. The Android implementation
 * lives in the Activity (ThemeManager); tests use a plain fake.
 */
interface ThemePort {
    fun state(): ThemeState
    fun setMode(mode: String?): ThemeState
}

/** `app.ping`, `app.info`, `app.theme.get`, `app.theme.set`. */
class AppHandler(
    private val theme: ThemePort,
    private val appInfo: () -> AppInfo,
    private val json: Json = BridgeJson.value
) : BridgeHandler {

    companion object {
        val METHODS = setOf("app.ping", "app.info", "app.theme.get", "app.theme.set")
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "app.ping" -> json.encodeToJsonElement(PingReply.serializer(), PingReply(pong = true))
        "app.info" -> json.encodeToJsonElement(AppInfo.serializer(), appInfo())
        "app.theme.get" -> json.encodeToJsonElement(ThemeState.serializer(), theme.state())
        "app.theme.set" -> {
            val request = json.decodePayload(ThemeSetRequest.serializer(), payload, method)
            json.encodeToJsonElement(ThemeState.serializer(), theme.setMode(request.mode))
        }
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }
}
