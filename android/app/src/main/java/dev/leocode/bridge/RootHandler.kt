package dev.leocode.bridge

import dev.leocode.core.RootManager
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * `root.status`, `root.request`, and `root.disable`, `docs/bridge-contract.md` (Phase E, Task 17).
 *
 * `root.status` never prompts.
 * `root.request` is user-driven and prompts the superuser manager.
 * `root.disable` clears the host preference, triggers disable hooks, and never prompts.
 */
class RootHandler(
    private val rootManager: RootManager,
    private val json: Json = BridgeJson.value,
    private val onDisabled: () -> Unit = {},
    private val log: (String) -> Unit = {}
) : BridgeHandler {

    @Volatile
    private var lastLoggedStatus: RootManager.Status? = null

    companion object {
        val METHODS = setOf("root.status", "root.request", "root.disable")
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "root.status" -> status()
        "root.request" -> request()
        "root.disable" -> disable()
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    private fun status(): JsonElement {
        val st = rootManager.status()
        val prev = lastLoggedStatus
        if (prev == null || prev.available != st.available || prev.granted != st.granted || prev.enabled != st.enabled) {
            lastLoggedStatus = st
            log("root.status => available=${st.available}, granted=${st.granted}, enabled=${st.enabled}, su=${rootManager.findSuBinary()}")
        }
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
        log("root.request invoked")
        val granted = rootManager.requestGrant()
        log("root.request result => granted=$granted")
        return json.encodeToJsonElement(
            RootRequestReply.serializer(),
            RootRequestReply(granted = granted)
        )
    }

    private fun disable(): JsonElement {
        log("root.disable invoked")
        rootManager.setEnabled(false)
        runCatching {
            onDisabled()
        }.onFailure {
            log("root.disable onDisabled hook failed: ${it.message}")
        }
        return status()
    }
}
