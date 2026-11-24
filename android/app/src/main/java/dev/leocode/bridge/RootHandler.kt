package dev.leocode.bridge

import android.util.Log
import dev.leocode.core.RootManager
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * `root.status` and `root.request`, `docs/bridge-contract.md` (Phase E, Task 17).
 *
 * `root.status` never prompts.
 * `root.request` is user-driven and prompts the superuser manager.
 */
class RootHandler(
    private val rootManager: RootManager,
    private val json: Json = BridgeJson.value,
    private val onDisabled: () -> Unit = {},
    private val log: (String) -> Unit = {}
) : BridgeHandler {

    companion object {
        val METHODS = setOf("root.status", "root.request")
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "root.status" -> status()
        "root.request" -> request()
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    private fun status(): JsonElement {
        val st = rootManager.status()
        Log.i("LeoCodeRoot", "root.status => available=${st.available}, granted=${st.granted}, enabled=${st.enabled}, su=${rootManager.findSuBinary()}")
        return json.encodeToJsonElement(
            RootStatusReply.serializer(),
            RootStatusReply(
                available = st.available,
                granted = st.granted,
                enabled = st.enabled
            )
        )
    }

    private fun request(): JsonElement {
        Log.i("LeoCodeRoot", "root.request invoked")
        val granted = rootManager.requestGrant()
        Log.i("LeoCodeRoot", "root.request result => granted=$granted")
        return json.encodeToJsonElement(
            RootRequestReply.serializer(),
            RootRequestReply(granted = granted)
        )
    }
}
