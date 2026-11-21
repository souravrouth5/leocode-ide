package dev.leocode.bridge

import dev.leocode.core.secrets.SecretUnavailableException
import dev.leocode.ssh.HostKeyPrompts
import dev.leocode.ssh.KnownHostsStore
import dev.leocode.ssh.SshKeyStore
import java.io.IOException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * `ssh.keys.*` and `ssh.hostkey.*` (Task 23).
 *
 * Key generation/import and known-host management are short operations; the
 * only blocking call is `ssh.hostkey.answer`, which completes a prompt that the
 * Git request is already waiting on. No reply contains private key material,
 * passphrases or token values.
 */
class SshHandler(
    private val keyStore: SshKeyStore,
    private val knownHosts: KnownHostsStore,
    private val prompts: HostKeyPrompts,
    private val json: Json = BridgeJson.value
) : BridgeHandler {

    companion object {
        val METHODS = setOf(
            "ssh.keys.list",
            "ssh.keys.generate",
            "ssh.keys.import",
            "ssh.keys.delete",
            "ssh.hostkey.answer",
            "ssh.hostkey.list",
            "ssh.hostkey.delete"
        )
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "ssh.keys.list" -> guard {
            json.encodeToJsonElement(
                SshKeyListReply.serializer(),
                SshKeyListReply(keyStore.list())
            )
        }

        "ssh.keys.generate" -> {
            val request = json.decodePayload(SshKeyGenerateRequest.serializer(), payload, method)
            json.encodeToJsonElement(
                SshKeyInfo.serializer(),
                guard { keyStore.generate(request) }
            )
        }

        "ssh.keys.import" -> {
            val request = json.decodePayload(SshKeyImportRequest.serializer(), payload, method)
            json.encodeToJsonElement(
                SshKeyInfo.serializer(),
                guard { keyStore.import(request) }
            )
        }

        "ssh.keys.delete" -> {
            val request = json.decodePayload(SshKeyIdRequest.serializer(), payload, method)
            val id = request.id?.trim().orEmpty()
            if (id.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "id is required")
            guard { keyStore.delete(id) }
            json.encodeToJsonElement(GitOk.serializer(), GitOk())
        }

        "ssh.hostkey.answer" -> {
            val request = json.decodePayload(SshHostAnswerRequest.serializer(), payload, method)
            val promptId = request.promptId?.trim().orEmpty()
            if (promptId.isEmpty()) {
                throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "promptId is required")
            }
            json.encodeToJsonElement(
                GitOk.serializer(),
                GitOk(prompts.answer(promptId, request.trust, request.remember))
            )
        }

        "ssh.hostkey.list" -> guard {
            val hosts = knownHosts.entries().map { entry ->
                SshKnownHostInfo(
                    host = entry.host,
                    port = entry.port,
                    keyType = entry.keyType,
                    fingerprint = runCatching { entry.fingerprint() }.getOrDefault(""),
                    addedAt = entry.addedAt
                )
            }
            json.encodeToJsonElement(
                SshKnownHostListReply.serializer(),
                SshKnownHostListReply(hosts)
            )
        }

        "ssh.hostkey.delete" -> {
            val request = json.decodePayload(SshKnownHostDeleteRequest.serializer(), payload, method)
            val host = request.host?.trim().orEmpty()
            if (host.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "host is required")
            guard { knownHosts.delete(host, request.port) }
            json.encodeToJsonElement(GitOk.serializer(), GitOk())
        }

        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    private inline fun <T> guard(block: () -> T): T = try {
        block()
    } catch (e: SecretUnavailableException) {
        throw BridgeException(ErrorCode.E_UNSUPPORTED, e.message ?: "secrets are unavailable")
    } catch (e: IOException) {
        throw BridgeException(ErrorCode.E_IO, e.message ?: "SSH operation failed")
    }
}
