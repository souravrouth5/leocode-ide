package dev.leocode.bridge

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * The bridge wire contract as serializable DTOs (Task 7).
 *
 * Handlers build their replies from these classes instead of ad-hoc JSON, and
 * `./gradlew generateBridgeTypes` walks their serial descriptors to write
 * `web/src/bridge/types.gen.ts`. Renaming or retyping a field here without
 * regenerating makes the web typecheck fail.
 */

// ---------------------------------------------------------------- envelope

@Serializable
data class BridgeReply(
    val v: Int = 1,
    val id: JsonElement? = null,
    val ok: Boolean = true,
    val payload: JsonElement? = null,
    val error: BridgeErrorBody? = null
)

@Serializable
data class BridgeEvent(
    val v: Int = 1,
    val id: JsonElement? = null,
    val event: String,
    val payload: JsonElement? = null
)

// --------------------------------------------------------------------- app

@Serializable
data class PingReply(val pong: Boolean)

@Serializable
data class ThemeState(val mode: String, val effective: String)

@Serializable
data class ThemeSetRequest(val mode: String? = null)

@Serializable
data class AppInfo(
    val app: String,
    val version: String,
    val mode: String,
    val androidSdk: Int = 0,
    val androidRelease: String = "",
    val abi: String = "",
    val webview: String = "",
    val workspace: String = "",
    val theme: ThemeState
)

// ---------------------------------------------------------------------- fs

@Serializable
data class FileEntry(
    val name: String,
    val path: String,
    val kind: String,
    val size: Long,
    val mtime: Long
)

@Serializable
data class PathRequest(val path: String? = null)

@Serializable
data class PathReply(val path: String)

@Serializable
data class ReadReply(val path: String, val content: String, val size: Int)

@Serializable
data class WriteRequest(val path: String? = null, val content: String? = null)

@Serializable
data class WriteReply(val path: String, val size: Long)

@Serializable
data class RenameRequest(val from: String? = null, val to: String? = null)

@Serializable
data class RenameReply(val from: String, val to: String)

@Serializable
data class DeleteReply(val deleted: String)

// -------------------------------------------------------------------- proc

@Serializable
data class ProcRunRequest(
    val argv: List<String> = emptyList(),
    val cwd: String? = null,
    val env: Map<String, String> = emptyMap(),
    val timeoutMs: Long? = null
)

@Serializable
data class ProcRunReply(val jobId: String, val pid: Int)

@Serializable
data class ProcCancelRequest(val jobId: String? = null)

@Serializable
data class ProcCancelReply(val cancelled: Boolean)

@Serializable
data class ProcOutput(val data: String)

@Serializable
data class ProcExit(val code: Int)

// -------------------------------------------------------------------- term

@Serializable
data class TermOpenRequest(val cwd: String? = null, val cols: Int? = null, val rows: Int? = null)

@Serializable
data class TermOpenReply(val sessionId: String, val pid: Int)

@Serializable
data class TermWriteRequest(val sessionId: String? = null, val b64: String? = null)

@Serializable
data class TermWriteReply(val accepted: Int)

@Serializable
data class TermSessionRequest(val sessionId: String? = null)

@Serializable
data class TermResizeRequest(val sessionId: String? = null, val cols: Int? = null, val rows: Int? = null)

@Serializable
data class TermOk(val ok: Boolean = true)

@Serializable
data class TermAckRequest(val sessionId: String? = null, val bytes: Int? = null)

@Serializable
data class TermCloseReply(val closed: Boolean)

/** `term.attach` reply. Scrollback is base64 terminal bytes. */
@Serializable
data class TermAttachReply(
    val sessionId: String,
    val scrollback: String,
    val alive: Boolean,
    val exitCode: Int
)

/** One entry in the `term.list` array. */
@Serializable
data class TermInfo(
    val sessionId: String,
    val root: Boolean = false,
    val alive: Boolean,
    val title: String,
    val pid: Int,
    val cwd: String
)

@Serializable
data class TermData(val b64: String)

@Serializable
data class TermExit(val code: Int)

// --------------------------------------------------------------------- saf

@Serializable
data class SafOpenRequest(val mime: String? = null)

@Serializable
data class SafOpenReply(val name: String, val uri: String, val content: String, val size: Int)

@Serializable
data class SafSaveRequest(val name: String? = null, val content: String? = null)

@Serializable
data class SafSaveReply(val name: String, val uri: String)

@Serializable
data class StorageInfo(
    val hasPermission: Boolean,
    val internalStorage: String,
    val downloads: String,
    val documents: String,
    val workspace: String
)

@Serializable
data class StoragePermissionReply(val granted: Boolean)

// ----------------------------------------------------------------- runtime

@Serializable
data class RuntimeInstallRequest(val id: String? = null)

@Serializable
data class RuntimeInstallReply(val id: String, val installed: Boolean)

@Serializable
data class RuntimeProgress(val phase: String, val bytes: Long, val total: Long, val message: String)

@Serializable
data class RuntimeCancelRequest(val id: String? = null)

@Serializable
data class RuntimeCancelReply(val cancelling: Boolean)
