package dev.leocode.bridge

import dev.leocode.workspace.SearchEngine
import dev.leocode.workspace.SearchMatch as EngineMatch
import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * `fs.search` and `fs.search.cancel` (Task 16).
 *
 * Matches stream as `search.match` events while the request is running; the reply
 * arrives last with `{ count, truncated }`. Cancellation is a second bridge method
 * that flips the flag the engine polls, so an abandoned search stops walking the
 * tree instead of finishing and flooding the WebView.
 */
class SearchHandler(
    private val engine: SearchEngine,
    private val root: () -> File,
    private val json: Json = BridgeJson.value
) : StreamingBridgeHandler {

    companion object {
        val METHODS = setOf("fs.search", "fs.search.cancel")
    }

    /** One flag per running search; `cancelled` is true only while it runs. */
    private val active = ConcurrentHashMap<String, AtomicBoolean>()

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement =
        handle(method, payload, NoopStreamSink)

    override fun handle(method: String, payload: JsonObject, sink: StreamSink): JsonElement =
        when (method) {
            "fs.search" -> search(payload, sink)
            "fs.search.cancel" -> cancel(payload)
            else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
        }

    private fun search(payload: JsonObject, sink: StreamSink): JsonElement {
        val request = json.decodePayload(SearchRequest.serializer(), payload, "fs.search")
        val query = request.query?.takeIf { it.isNotEmpty() }
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "query is required")
        val searchId = request.searchId?.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString()

        val flag = AtomicBoolean(false)
        if (active.putIfAbsent(searchId, flag) != null) {
            throw BridgeException(ErrorCode.E_BUSY, "a search with this id is already running")
        }
        try {
            val result = engine.search(
                root = root(),
                query = query,
                glob = request.glob,
                maxResults = request.maxResults,
                caseSensitive = request.caseSensitive,
                isCancelled = { flag.get() },
                onMatch = { match ->
                    sink.event(
                        "search.match",
                        json.encodeToJsonElement(
                            SearchMatch.serializer(),
                            SearchMatch(
                                path = match.path,
                                line = match.line,
                                col = match.col,
                                preview = match.preview
                            )
                        )
                    )
                }
            )
            return json.encodeToJsonElement(
                SearchDone.serializer(),
                SearchDone(result.count, result.truncated)
            )
        } finally {
            active.remove(searchId)
        }
    }

    private fun cancel(payload: JsonObject): JsonElement {
        val request = json.decodePayload(
            SearchCancelRequest.serializer(),
            payload,
            "fs.search.cancel"
        )
        val searchId = request.searchId?.takeIf { it.isNotBlank() }
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "searchId is required")
        val flag = active[searchId]
        flag?.set(true)
        active.remove(searchId)
        return json.encodeToJsonElement(
            SearchCancelReply.serializer(),
            SearchCancelReply(cancelled = flag != null)
        )
    }
}
