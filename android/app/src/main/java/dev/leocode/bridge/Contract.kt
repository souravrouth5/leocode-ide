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

/** `app.diagnostics`: redacted support report (Task 27). */
@Serializable
data class DiagnosticsReply(val report: String)

/** `app.share`: hand redacted text to the system share sheet (Task 27). */
@Serializable
data class ShareRequest(val text: String)

@Serializable
data class ShareReply(val shared: Boolean)

/** `update.check`: signed release manifest result (Task 28). */
@Serializable
data class UpdateCheckReply(
    val available: Boolean,
    val currentVersion: String,
    val versionName: String? = null,
    val versionCode: Int? = null,
    val notes: String? = null,
    val url: String? = null,
    val sha256: String? = null,
    val size: Long? = null
)

/** `update.install`: the verified manifest fields the user agreed to. */
@Serializable
data class UpdateInstallRequest(
    val url: String,
    val sha256: String,
    val size: Long,
    val versionCode: Int
)

@Serializable
data class UpdateInstallReply(val started: Boolean)

/** Streamed while `update.install` downloads and verifies. */
@Serializable
data class UpdateProgress(val phase: String, val bytes: Long, val total: Long)

/** Terminal event for `update.install`. */
@Serializable
data class UpdateResult(val ok: Boolean, val code: String? = null, val message: String? = null)

@Serializable
data class UpdateCancelReply(val cancelling: Boolean)

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
data class ReadRequest(
    val path: String? = null,
    /** Byte offset for a chunked read (Task 15). */
    val offset: Long = 0L,
    /** Maximum bytes for this chunk; 0 means the host default. */
    val maxBytes: Int = 0
)

@Serializable
data class ReadReply(
    val path: String,
    val content: String,
    val size: Long,
    /** Next byte offset, or -1 once the whole file has been returned. */
    val nextOffset: Long = -1L,
    val mtime: Long = 0L,
    val hash: String = ""
)

@Serializable
data class WriteRequest(
    val path: String? = null,
    val content: String? = null,
    /** When set, the write fails with E_CONFLICT if the file changed on disk. */
    val expectedHash: String? = null
)

@Serializable
data class WriteReply(
    val path: String,
    val size: Long,
    val mtime: Long = 0L,
    val hash: String = ""
)

@Serializable
data class StatRequest(val path: String? = null)

@Serializable
data class StatReply(
    val path: String,
    val kind: String,
    val size: Long,
    val mtime: Long,
    val hash: String
)

@Serializable
data class RenameRequest(val from: String? = null, val to: String? = null)

@Serializable
data class RenameReply(val from: String, val to: String)

@Serializable
data class DeleteReply(val deleted: String)

// ---------------------------------------------------------------- workspace

@Serializable
data class WorkspaceInfo(
    val id: String,
    val name: String,
    val path: String,
    val lastOpened: Long,
    val createdAt: Long = 0L
)

@Serializable
data class WorkspaceCreateRequest(val name: String? = null)

@Serializable
data class WorkspaceIdRequest(val id: String? = null)

@Serializable
data class WorkspaceRenameRequest(val id: String? = null, val name: String? = null)

@Serializable
data class WorkspaceReply(val id: String, val name: String, val path: String)

@Serializable
data class WorkspaceListReply(
    val active: String,
    val workspaces: List<WorkspaceInfo>
)

@Serializable
data class WorkspaceOk(val ok: Boolean = true)

// ------------------------------------------------------------------ drafts

@Serializable
data class DraftInfo(
    val path: String,
    val mtime: Long,
    val size: Int
)

@Serializable
data class DraftRequest(val path: String? = null)

@Serializable
data class DraftSaveRequest(
    val path: String? = null,
    val content: String? = null,
    val eol: String = "\n"
)

@Serializable
data class DraftReadReply(
    val path: String,
    val content: String,
    val eol: String,
    val mtime: Long
)

// ------------------------------------------------------------------ search

@Serializable
data class SearchRequest(
    val query: String? = null,
    val glob: String? = null,
    val maxResults: Int = 500,
    val caseSensitive: Boolean = false,
    /** Client-generated id used by `fs.search.cancel`. */
    val searchId: String? = null
)

@Serializable
data class SearchMatch(
    val path: String,
    val line: Int,
    val col: Int,
    val preview: String
)

@Serializable
data class SearchDone(val count: Int, val truncated: Boolean)

@Serializable
data class SearchCancelRequest(val searchId: String? = null)

@Serializable
data class SearchCancelReply(val cancelled: Boolean)

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
data class SafImportRequest(val dest: String? = null)

@Serializable
data class SafImportReply(val path: String, val files: Int, val bytes: Long)

@Serializable
data class SafExportRequest(val name: String? = null)

@Serializable
data class SafExportReply(val name: String, val uri: String, val files: Int, val bytes: Long)

@Serializable
data class SafRestoreRequest(val confirm: Boolean = false)

@Serializable
data class SafRestoreReply(val files: Int, val bytes: Long)

@Serializable
data class SafProgress(val phase: String, val files: Int, val bytes: Long)

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
data class RuntimeInstallReply(val id: String, val started: Boolean)

/** Terminal event for `runtime.install` / `runtime.repair`. */
@Serializable
data class RuntimeResult(
    val id: String,
    val ok: Boolean,
    val code: String? = null,
    val message: String? = null
)

@Serializable
data class RuntimeCatalogEntry(
    val id: String,
    val version: String,
    val versionCode: Int,
    val installed: Boolean,
    val healthy: Boolean,
    val installedVersionCode: Int? = null
)

@Serializable
data class RuntimeProgress(val phase: String, val bytes: Long, val total: Long, val message: String)

@Serializable
data class RuntimeCancelRequest(val id: String? = null)

@Serializable
data class RuntimeCancelReply(val cancelling: Boolean)

// ------------------------------------------------------------- trust/python
// Task 26: per-project trust decisions and the Python environment.

@Serializable
data class TrustRequest(
    val project: String? = null,
    val action: String? = null,
    /** The script for `script`, relative to the project; ignored by other actions. */
    val path: String? = null
)

@Serializable
data class TrustReply(
    val trusted: Boolean,
    val action: String,
    val fingerprint: String
)

@Serializable
data class TrustRevokeRequest(val project: String? = null, val action: String? = null)

@Serializable
data class PythonProjectRequest(val project: String? = null)

@Serializable
data class PythonStatusReply(
    val runtimeInstalled: Boolean,
    val runtimePython: String? = null,
    val venvExists: Boolean,
    val venvPath: String,
    val venvPython: String? = null,
    val requirementsExists: Boolean,
    val requirementsPath: String? = null,
    val requirementsHash: String? = null,
    val requirementsInstalled: Boolean,
    val aliasesReady: Boolean
)

@Serializable
data class PythonVenvReply(val created: Boolean, val status: PythonStatusReply)

@Serializable
data class PythonRequirementsReply(val ok: Boolean, val exitCode: Int, val output: String)

@Serializable
data class PythonInstallEvent(val data: String)

// ----------------------------------------------------------------- secrets

@Serializable
data class SecretSetRequest(val host: String? = null, val token: String? = null)

@Serializable
data class SecretHostsReply(val hosts: List<String> = emptyList())

// --------------------------------------------------------------------- git

@Serializable
data class GitRepoRequest(val path: String? = null)

@Serializable
data class GitFileChange(
    val path: String,
    /**
     * `added`, `modified`, `deleted`, `renamed`, `copied`, `untracked` or
     * `conflicted`. A rename keeps its source in [oldPath].
     */
    val status: String,
    val oldPath: String? = null
)

@Serializable
data class GitStatusReply(
    val initialized: Boolean,
    /** Absolute repository root, for the UI header only. */
    val root: String = "",
    val branch: String = "",
    /** Short HEAD sha, or null in a repository without commits. */
    val head: String? = null,
    val upstream: String? = null,
    val remote: String? = null,
    val ahead: Int = 0,
    val behind: Int = 0,
    val staged: List<GitFileChange> = emptyList(),
    val changed: List<GitFileChange> = emptyList(),
    val untracked: List<GitFileChange> = emptyList(),
    val conflicts: List<GitFileChange> = emptyList(),
    val clean: Boolean = true
)

@Serializable
data class GitInitRequest(val path: String? = null, val branch: String? = null)

@Serializable
data class GitPathsRequest(
    val path: String? = null,
    val paths: List<String> = emptyList()
)

@Serializable
data class GitCommitRequest(
    val path: String? = null,
    val message: String? = null,
    val authorName: String? = null,
    val authorEmail: String? = null
)

@Serializable
data class GitCommitReply(val sha: String, val shortSha: String)

@Serializable
data class GitDiffRequest(
    val path: String? = null,
    /** Repository-relative file; null means the whole working tree. */
    val file: String? = null,
    val staged: Boolean = false,
    val maxBytes: Int = 262_144
)

@Serializable
data class GitDiffReply(
    val file: String? = null,
    val diff: String = "",
    val truncated: Boolean = false,
    val binary: Boolean = false
)

@Serializable
data class GitLogRequest(val path: String? = null, val max: Int = 50)

@Serializable
data class GitCommitInfo(
    val sha: String,
    val shortSha: String,
    val author: String,
    val email: String,
    val time: Long,
    val message: String
)

@Serializable
data class GitLogReply(val commits: List<GitCommitInfo> = emptyList())

@Serializable
data class GitBranchInfo(
    val name: String,
    val current: Boolean = false,
    val remote: Boolean = false,
    val sha: String = ""
)

@Serializable
data class GitBranchListReply(
    val branches: List<GitBranchInfo> = emptyList(),
    val current: String = ""
)

@Serializable
data class GitBranchRequest(
    val path: String? = null,
    val name: String? = null,
    val startPoint: String? = null
)

@Serializable
data class GitCheckoutRequest(
    val path: String? = null,
    val name: String? = null,
    val create: Boolean = false
)

/** `kind` is `https`, `ssh` or `none`. */
@Serializable
data class GitAuth(
    val kind: String = "none",
    val username: String? = null,
    val token: String? = null,
    val keyId: String? = null,
    val passphrase: String? = null
)

@Serializable
data class GitRemoteInfo(
    val name: String,
    val url: String,
    val authKind: String = "none",
    val username: String? = null,
    val hasToken: Boolean = false,
    val keyId: String? = null
)

@Serializable
data class GitRemoteListReply(
    val remotes: List<GitRemoteInfo> = emptyList(),
    val current: String? = null
)

@Serializable
data class GitRemoteSetRequest(
    val path: String? = null,
    val name: String? = null,
    val url: String? = null,
    val authKind: String? = null,
    val username: String? = null,
    /** When present, stored in the SecretStore; never returned. */
    val token: String? = null,
    val keyId: String? = null
)

@Serializable
data class GitCloneRequest(
    val url: String? = null,
    /** Destination relative to the active workspace; defaults to the repo name. */
    val path: String? = null,
    val name: String? = null,
    val auth: GitAuth? = null,
    val opId: String? = null
)

@Serializable
data class GitSyncRequest(
    val path: String? = null,
    val remote: String? = null,
    val branch: String? = null,
    val auth: GitAuth? = null,
    val opId: String? = null,
    val force: Boolean = false
)

@Serializable
data class GitSyncReply(
    val branch: String = "",
    val ahead: Int = 0,
    val behind: Int = 0,
    val message: String = ""
)

@Serializable
data class GitCancelRequest(val opId: String? = null)

@Serializable
data class GitCancelReply(val cancelled: Boolean)

@Serializable
data class GitConflictRequest(val path: String? = null, val file: String? = null)

@Serializable
data class GitConflictReply(
    val file: String,
    val merged: String = "",
    val ours: String? = null,
    val theirs: String? = null,
    val base: String? = null,
    val binary: Boolean = false
)

/** `strategy` is `ours` or `theirs` (whole file). Per-block edits use `fs.write`. */
@Serializable
data class GitResolveRequest(
    val path: String? = null,
    val file: String? = null,
    val strategy: String? = null
)

@Serializable
data class GitProgress(
    val op: String,
    val opId: String? = null,
    val task: String = "",
    val done: Int = 0,
    val total: Int = 0
)

// --------------------------------------------------------------------- ssh

@Serializable
data class SshKeyInfo(
    val id: String,
    val label: String,
    val type: String,
    val fingerprint: String,
    val comment: String = "",
    val hasPassphrase: Boolean = false,
    val createdAt: Long = 0,
    /** One OpenSSH public-key line, safe to show and copy. */
    val publicKey: String = ""
)

@Serializable
data class SshKeyListReply(val keys: List<SshKeyInfo> = emptyList())

@Serializable
data class SshKeyGenerateRequest(
    /** `ed25519` (default) or `rsa`. */
    val type: String? = null,
    val comment: String? = null,
    val passphrase: String? = null,
    val label: String? = null,
    val bits: Int = 0
)

@Serializable
data class SshKeyImportRequest(
    val content: String? = null,
    val passphrase: String? = null,
    val label: String? = null
)

@Serializable
data class SshKeyIdRequest(val id: String? = null)

@Serializable
data class SshHostAnswerRequest(
    val promptId: String? = null,
    val trust: Boolean = false,
    val remember: Boolean = true
)

@Serializable
data class SshKnownHostInfo(
    val host: String,
    val port: Int = 22,
    val keyType: String,
    val fingerprint: String,
    val addedAt: Long = 0
)

@Serializable
data class SshKnownHostListReply(val hosts: List<SshKnownHostInfo> = emptyList())

@Serializable
data class SshKnownHostDeleteRequest(val host: String? = null, val port: Int = 22)

@Serializable
data class SshHostPrompt(
    val promptId: String,
    val host: String,
    val port: Int,
    val keyType: String,
    val fingerprintSha256: String,
    val changed: Boolean = false,
    val previousFingerprint: String? = null
)

@Serializable
data class GitOk(val ok: Boolean = true)
