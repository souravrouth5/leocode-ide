package dev.leocode.bridge

import dev.leocode.core.secrets.FileSecretStore
import dev.leocode.core.secrets.SecretUnavailableException
import java.io.IOException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * `secrets.token.set/delete/list` (Task 20).
 *
 * A token is keyed by host (`token:github.com`) and stored as UTF-8 inside the
 * Keystore-sealed secret store. The list reply contains host names only; no
 * method returns the value, and nothing is logged.
 */
class SecretHandler(
    private val secrets: FileSecretStore,
    private val json: Json = BridgeJson.value
) : BridgeHandler {

    companion object {
        val METHODS = setOf(
            "secrets.token.set",
            "secrets.token.delete",
            "secrets.token.list"
        )
        private const val PREFIX = "token:"
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "secrets.token.set" -> {
            val request = json.decodePayload(SecretSetRequest.serializer(), payload, method)
            val host = request.host?.trim().orEmpty()
            val token = request.token
            if (host.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "host is required")
            if (token.isNullOrEmpty()) {
                throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "token is required")
            }
            guard { secrets.put(PREFIX + host, token.toByteArray(Charsets.UTF_8)) }
            json.encodeToJsonElement(GitOk.serializer(), GitOk())
        }

        "secrets.token.delete" -> {
            val request = json.decodePayload(SecretSetRequest.serializer(), payload, method)
            val host = request.host?.trim().orEmpty()
            if (host.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "host is required")
            guard { secrets.delete(PREFIX + host) }
            json.encodeToJsonElement(GitOk.serializer(), GitOk())
        }

        "secrets.token.list" -> {
            val hosts = guard {
                secrets.ids()
                    .filter { it.startsWith(PREFIX) }
                    .map { it.removePrefix(PREFIX) }
            }
            json.encodeToJsonElement(SecretHostsReply.serializer(), SecretHostsReply(hosts))
        }

        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    private inline fun <T> guard(block: () -> T): T = try {
        block()
    } catch (e: SecretUnavailableException) {
        throw BridgeException(ErrorCode.E_UNSUPPORTED, e.message ?: "secrets are unavailable")
    } catch (e: IOException) {
        throw BridgeException(ErrorCode.E_IO, "cannot access stored tokens")
    }
}
