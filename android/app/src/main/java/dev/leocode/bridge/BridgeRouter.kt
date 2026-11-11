package dev.leocode.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import java.util.UUID

/**
 * Envelope validation and method dispatch for the typed bridge handlers.
 *
 * [dispatch] always returns exactly one complete reply object and never lets an
 * exception escape. Handler failures keep their typed [ErrorCode]; anything else
 * becomes `E_INTERNAL` with a fixed safe message and a correlation id that only
 * appears in the injected [log].
 */
class BridgeRouter(
    private val json: Json,
    handlers: List<BridgeHandler>,
    private val log: (String) -> Unit = {}
) {

    companion object {
        private const val INTERNAL_MESSAGE = "Something went wrong"
    }

    private val handlersByMethod: Map<String, BridgeHandler> = buildMap {
        for (handler in handlers) {
            for (method in handler.methods()) {
                require(method !in this) { "bridge method $method is registered twice" }
                put(method, handler)
            }
        }
    }

    /** Method names served by this router; anything else falls through to legacy code. */
    val methods: Set<String> get() = handlersByMethod.keys

    fun handles(method: String?): Boolean = method != null && handlersByMethod.containsKey(method)

    /** Validates [request] and returns `{v,id,ok,payload}` or `{v,id,ok:false,error}`. */
    fun dispatch(request: JsonObject): JsonObject {
        val id = request["id"] ?: JsonNull
        return try {
            val rejection = validate(request, id)
            if (rejection != null) {
                rejection
            } else {
                reply(id, execute(request))
            }
        } catch (e: BridgeException) {
            errorReply(id, e.errorCode, e.message)
        } catch (e: Throwable) {
            val correlationId = newCorrelationId()
            log("E_INTERNAL $correlationId: ${e.javaClass.name}: ${e.message}")
            errorReply(id, ErrorCode.E_INTERNAL, INTERNAL_MESSAGE, correlationId)
        }
    }

    private fun validate(request: JsonObject, id: JsonElement): JsonObject? {
        val version = (request["v"] as? JsonPrimitive)?.intOrNull
        if (request["v"] != null && request["v"] != JsonNull && version != 1) {
            return errorReply(id, ErrorCode.E_UNSUPPORTED, "unsupported protocol version")
        }
        if (methodOf(request) == null) {
            return errorReply(id, ErrorCode.E_BAD_ENVELOPE, "method is required")
        }
        return null
    }

    private fun execute(request: JsonObject): JsonElement {
        val method = methodOf(request)
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "method is required")
        val handler = handlersByMethod[method]
            ?: throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
        val payload = (request["payload"] as? JsonObject) ?: JsonObject(emptyMap())
        return handler.handle(method, payload)
    }

    private fun methodOf(request: JsonObject): String? =
        (request["method"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() }

    private fun reply(id: JsonElement, payload: JsonElement): JsonObject = buildJsonObject {
        put("v", 1)
        put("id", id)
        put("ok", true)
        put("payload", payload)
    }

    private fun errorReply(
        id: JsonElement,
        code: ErrorCode,
        message: String,
        correlationId: String? = null
    ): JsonObject = buildJsonObject {
        put("v", 1)
        put("id", id)
        put("ok", false)
        put(
            "error",
            runCatching {
                json.encodeToJsonElement(
                    BridgeErrorBody.serializer(),
                    BridgeErrorBody(code.code, message, correlationId)
                )
            }.getOrElse {
                buildJsonObject {
                    put("code", code.code)
                    put("message", message)
                    if (correlationId != null) put("correlationId", correlationId)
                }
            }
        )
    }

    private fun newCorrelationId(): String = "c-" + UUID.randomUUID().toString().take(6)
}
