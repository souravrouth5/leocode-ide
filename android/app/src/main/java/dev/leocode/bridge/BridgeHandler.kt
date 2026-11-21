package dev.leocode.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** One bridge domain: a set of method names and the code that serves them. */
interface BridgeHandler {
    fun methods(): Set<String>

    /**
     * Handles [method] with the request [payload] and returns the reply payload.
     * Throwing [BridgeException] yields a typed error reply.
     */
    fun handle(method: String, payload: JsonObject): JsonElement
}
