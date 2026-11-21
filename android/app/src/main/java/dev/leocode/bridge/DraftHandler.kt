package dev.leocode.bridge

import dev.leocode.workspace.Draft
import dev.leocode.workspace.Drafts
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray

/**
 * `draft.*` — autosaved unsaved buffers for crash recovery (Task 15).
 *
 * A draft is keyed by the active workspace and its relative path. The web editor
 * writes one three seconds after typing stops and deletes it after a successful
 * save; the host never restores a draft by itself, the user chooses.
 */
class DraftHandler(
    private val drafts: Drafts,
    private val json: Json = BridgeJson.value
) : BridgeHandler {

    companion object {
        val METHODS = setOf("draft.list", "draft.read", "draft.save", "draft.delete")
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = try {
        dispatch(method, payload)
    } catch (e: BridgeException) {
        throw e
    } catch (e: IllegalArgumentException) {
        throw BridgeException(ErrorCode.E_BAD_ENVELOPE, e.message ?: "invalid draft request")
    } catch (e: java.io.IOException) {
        throw BridgeException(ErrorCode.E_IO, "cannot update the draft")
    }

    private fun dispatch(method: String, payload: JsonObject): JsonElement = when (method) {
        "draft.list" -> list()
        "draft.read" -> {
            val path = pathOf(payload, method)
            val draft = drafts.read(path)
                ?: throw BridgeException(ErrorCode.E_NOT_FOUND, "no draft for this file")
            json.encodeToJsonElement(DraftReadReply.serializer(), readReply(draft))
        }

        "draft.save" -> {
            val request = json.decodePayload(DraftSaveRequest.serializer(), payload, method)
            val path = request.path?.takeIf { it.isNotBlank() }
                ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "path is required")
            drafts.save(path, request.content ?: "", request.eol)
            json.encodeToJsonElement(WorkspaceOk.serializer(), WorkspaceOk())
        }

        "draft.delete" -> {
            drafts.delete(pathOf(payload, method))
            json.encodeToJsonElement(WorkspaceOk.serializer(), WorkspaceOk())
        }

        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    private fun list(): JsonArray = buildJsonArray {
        for (draft in drafts.list()) {
            add(
                json.encodeToJsonElement(
                    DraftInfo.serializer(),
                    DraftInfo(draft.path, draft.mtime, draft.size)
                )
            )
        }
    }

    private fun readReply(draft: Draft): DraftReadReply = DraftReadReply(
        path = draft.path,
        content = draft.content,
        eol = draft.eol,
        mtime = draft.mtime
    )

    private fun pathOf(payload: JsonObject, method: String): String =
        json.decodePayload(DraftRequest.serializer(), payload, method).path
            ?.takeIf { it.isNotBlank() }
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "path is required")
}
