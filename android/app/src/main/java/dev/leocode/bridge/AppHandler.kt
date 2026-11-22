package dev.leocode.bridge

import dev.leocode.core.Redactor
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

/** `app.ping`, `app.info`, `app.diagnostics`, `app.share`, `app.theme.*`. */
class AppHandler(
    private val theme: ThemePort,
    private val appInfo: () -> AppInfo,
    private val json: Json = BridgeJson.value,
    private val diagnostics: () -> String = { "" },
    private val share: (String) -> Boolean = { false }
) : BridgeHandler {

    companion object {
        val METHODS = setOf(
            "app.ping",
            "app.info",
            "app.diagnostics",
            "app.share",
            "app.theme.get",
            "app.theme.set"
        )
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "app.ping" -> json.encodeToJsonElement(PingReply.serializer(), PingReply(pong = true))
        "app.info" -> json.encodeToJsonElement(AppInfo.serializer(), appInfo())
        "app.diagnostics" -> json.encodeToJsonElement(
            DiagnosticsReply.serializer(),
            DiagnosticsReply(diagnostics())
        )
        "app.share" -> {
            val request = json.decodePayload(ShareRequest.serializer(), payload, method)
            // Defence in depth: the report is already redacted, but a future
            // caller cannot use this method to hand raw paths to another app.
            json.encodeToJsonElement(
                ShareReply.serializer(),
                ShareReply(shared = share(Redactor.redact(request.text)))
            )
        }
        "app.theme.get" -> json.encodeToJsonElement(ThemeState.serializer(), theme.state())
        "app.theme.set" -> {
            val request = json.decodePayload(ThemeSetRequest.serializer(), payload, method)
            json.encodeToJsonElement(ThemeState.serializer(), theme.setMode(request.mode))
        }
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }
}
