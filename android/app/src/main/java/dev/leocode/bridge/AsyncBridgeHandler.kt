package dev.leocode.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * A handler that answers after the request has returned (Task 6).
 *
 * SAF pickers, permission dialogs and long runtime installs cannot reply inside
 * `handle`. Such a handler calls [respond] exactly once, from any thread, and the
 * router turns that into the one reply for the request. Throwing before the
 * response produces the same typed/redacted error as a sync handler.
 */
interface AsyncBridgeHandler : BridgeHandler {
    fun handle(
        method: String,
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    )

    /** Async methods cannot be served by the synchronous [BridgeRouter.dispatch]. */
    override fun handle(method: String, payload: JsonObject): JsonElement =
        throw BridgeException(
            ErrorCode.E_INTERNAL,
            "async bridge method $method needs dispatchAsync"
        )
}

sealed interface AsyncReply {
    data class Ok(val payload: JsonElement) : AsyncReply
    data class Error(
        val code: ErrorCode,
        val message: String,
        val correlationId: String? = null
    ) : AsyncReply
}
