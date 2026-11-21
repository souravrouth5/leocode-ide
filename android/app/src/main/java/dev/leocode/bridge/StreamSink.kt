package dev.leocode.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * A request-scoped event port. Streaming handlers emit through this so the same
 * code works with a WebView, a test recorder or [NoopStreamSink].
 */
interface StreamSink {
    fun event(name: String, payload: JsonElement)

    fun text(name: String, text: String)

    fun bytes(name: String, bytes: ByteArray)
}

/** Discards everything; used when a streaming handler is called without a sink. */
object NoopStreamSink : StreamSink {
    override fun event(name: String, payload: JsonElement) = Unit

    override fun text(name: String, text: String) = Unit

    override fun bytes(name: String, bytes: ByteArray) = Unit
}

/** A [BridgeHandler] that can stream events for the request it is serving. */
interface StreamingBridgeHandler : BridgeHandler {
    fun handle(method: String, payload: JsonObject, sink: StreamSink): JsonElement
}
