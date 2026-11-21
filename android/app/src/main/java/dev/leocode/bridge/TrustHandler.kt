package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.TrustAction
import dev.leocode.core.TrustFingerprint
import dev.leocode.core.TrustStore
import dev.leocode.core.Workspace
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * `trust.check` / `trust.grant` / `trust.revoke` (Task 26).
 *
 * The host computes the fingerprint of the files the action is about, so the
 * WebView cannot claim a decision covers a file it has not shown the user. A
 * grant is remembered per project and action; any relevant edit changes the
 * fingerprint and the next check fails.
 */
class TrustHandler(
    private val workspace: Workspace,
    private val jail: PathJail,
    private val activeRoot: () -> File,
    private val store: TrustStore,
    private val json: Json = BridgeJson.value
) : BridgeHandler {

    companion object {
        val METHODS = setOf("trust.check", "trust.grant", "trust.revoke")
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = when (method) {
        "trust.check" -> {
            val request = json.decodePayload(TrustRequest.serializer(), payload, method)
            val action = actionOf(request.action)
            val project = projectOf(request.project)
            val fingerprint = fingerprint(project, action, request.path)
            json.encodeToJsonElement(
                TrustReply.serializer(),
                TrustReply(
                    trusted = store.check(project.path, action, fingerprint),
                    action = action.wire,
                    fingerprint = fingerprint
                )
            )
        }

        "trust.grant" -> {
            val request = json.decodePayload(TrustRequest.serializer(), payload, method)
            val action = actionOf(request.action)
            val project = projectOf(request.project)
            val fingerprint = fingerprint(project, action, request.path)
            store.grant(project.path, action, fingerprint)
            json.encodeToJsonElement(
                TrustReply.serializer(),
                TrustReply(true, action.wire, fingerprint)
            )
        }

        "trust.revoke" -> {
            val request = json.decodePayload(TrustRevokeRequest.serializer(), payload, method)
            val project = projectOf(request.project)
            val action = request.action?.let(::actionOf)
            store.revoke(project.path, action)
            json.encodeToJsonElement(
                TrustReply.serializer(),
                TrustReply(false, action?.wire ?: "", "")
            )
        }

        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    private fun actionOf(raw: String?): TrustAction =
        TrustAction.from(raw)
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "unknown trust action")

    private fun projectOf(raw: String?): File = try {
        val base = activeRoot()
        if (raw.isNullOrBlank()) {
            base.canonicalFile
        } else if (File(raw).isAbsolute) {
            jail.resolve(raw, base)
        } else {
            workspace.jail(base, raw)
        }
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "project is outside the allowed roots")
    }

    private fun fingerprint(project: File, action: TrustAction, path: String?): String = try {
        val extra = if (action == TrustAction.VENV) {
            File(workspace.usr, ".leocode-runtime.json").takeIf { it.isFile }
                ?.readText().orEmpty()
        } else {
            ""
        }
        TrustFingerprint.compute(project, action, path, extra)
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "script is outside the project")
    } catch (e: Exception) {
        throw BridgeException(ErrorCode.E_IO, "cannot fingerprint the project files")
    }
}
