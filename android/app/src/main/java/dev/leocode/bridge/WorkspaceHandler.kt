package dev.leocode.bridge

import dev.leocode.workspace.WorkspaceRecord
import dev.leocode.workspace.WorkspaceStore
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * `workspace.*` — multiple projects with a recent list (Task 14).
 *
 * Deletion goes through [WorkspaceStore], which moves the directory to the trash;
 * nothing here can permanently erase a project. Relative `fs.*` paths follow the
 * active workspace chosen by `workspace.open`.
 */
class WorkspaceHandler(
    private val store: WorkspaceStore,
    private val json: Json = BridgeJson.value
) : BridgeHandler {

    companion object {
        val METHODS = setOf(
            "workspace.list",
            "workspace.create",
            "workspace.open",
            "workspace.rename",
            "workspace.delete"
        )
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement = try {
        dispatch(method, payload)
    } catch (e: BridgeException) {
        throw e
    } catch (e: IllegalArgumentException) {
        throw BridgeException(ErrorCode.E_BAD_ENVELOPE, e.message ?: "invalid workspace request")
    } catch (e: NoSuchElementException) {
        throw BridgeException(ErrorCode.E_NOT_FOUND, "no such workspace")
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PERMISSION, e.message ?: "workspace is protected")
    } catch (e: IllegalStateException) {
        throw BridgeException(ErrorCode.E_IO, "cannot update the workspace list")
    }

    private fun dispatch(method: String, payload: JsonObject): JsonElement = when (method) {
        "workspace.list" -> list()
        "workspace.create" -> {
            val request = json.decodePayload(
                WorkspaceCreateRequest.serializer(),
                payload,
                method
            )
            reply(store.create(nameOf(request.name)))
        }

        "workspace.open" -> {
            val request = json.decodePayload(WorkspaceIdRequest.serializer(), payload, method)
            reply(store.open(idOf(request.id)))
        }

        "workspace.rename" -> {
            val request = json.decodePayload(
                WorkspaceRenameRequest.serializer(),
                payload,
                method
            )
            store.rename(idOf(request.id), nameOf(request.name))
            json.encodeToJsonElement(WorkspaceOk.serializer(), WorkspaceOk())
        }

        "workspace.delete" -> {
            val request = json.decodePayload(WorkspaceIdRequest.serializer(), payload, method)
            store.delete(idOf(request.id))
            json.encodeToJsonElement(WorkspaceOk.serializer(), WorkspaceOk())
        }

        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
    }

    private fun list(): JsonElement =
        json.encodeToJsonElement(
            WorkspaceListReply.serializer(),
            WorkspaceListReply(
                active = store.activeId(),
                workspaces = store.list().map(::info)
            )
        )

    private fun reply(record: WorkspaceRecord): JsonElement =
        json.encodeToJsonElement(
            WorkspaceReply.serializer(),
            WorkspaceReply(record.id, record.name, store.directory(record.id).absolutePath)
        )

    private fun info(record: WorkspaceRecord): WorkspaceInfo = WorkspaceInfo(
        id = record.id,
        name = record.name,
        path = store.directory(record.id).absolutePath,
        lastOpened = record.lastOpened,
        createdAt = record.createdAt
    )

    private fun idOf(id: String?): String =
        id?.takeIf { it.isNotBlank() }
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "workspace id is required")

    private fun nameOf(name: String?): String =
        name?.takeIf { it.isNotBlank() }
            ?: throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "workspace name is required")
}
