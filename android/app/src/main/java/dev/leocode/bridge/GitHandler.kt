package dev.leocode.bridge

import dev.leocode.git.GitEngine
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * `git.*` bridge methods (Tasks 21–22).
 *
 * imple operations answer synchronously. Clone/fetch/pull/push stream
 * `git.progress` through the request sink and can be cancelled from another
 * request with `git.cancel`; they reply only when the transfer finishes.
 */
class GitHandler(
    private val engine: GitEngine,
    private val json: Json = BridgeJson.value
) : StreamingBridgeHandler {

    companion object {
        val METHODS = setOf(
            "git.init",
            "git.status",
            "git.add",
            "git.reset",
            "git.commit",
            "git.diff",
            "git.log",
            "git.branch.list",
            "git.branch.create",
            "git.branch.delete",
            "git.checkout",
            "git.remote.list",
            "git.remote.set",
            "git.remote.remove",
            "git.clone",
            "git.fetch",
            "git.pull",
            "git.push",
            "git.cancel",
            "git.conflict",
            "git.resolve"
        )
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonElement =
        handle(method, payload, NoopStreamSink)

    override fun handle(method: String, payload: JsonObject, sink: StreamSink): JsonElement =
        when (method) {
            "git.init" -> encode(GitStatusReply.serializer(), engine.init(decode(GitInitRequest.serializer(), payload, method)))
            "git.status" -> encode(GitStatusReply.serializer(), engine.status(decode(GitRepoRequest.serializer(), payload, method)))
            "git.add" -> encode(GitStatusReply.serializer(), engine.add(decode(GitPathsRequest.serializer(), payload, method)))
            "git.reset" -> encode(GitStatusReply.serializer(), engine.reset(decode(GitPathsRequest.serializer(), payload, method)))
            "git.commit" -> encode(GitCommitReply.serializer(), engine.commit(decode(GitCommitRequest.serializer(), payload, method)))
            "git.diff" -> encode(GitDiffReply.serializer(), engine.diff(decode(GitDiffRequest.serializer(), payload, method)))
            "git.log" -> encode(GitLogReply.serializer(), engine.log(decode(GitLogRequest.serializer(), payload, method)))
            "git.branch.list" -> encode(GitBranchListReply.serializer(), engine.branches(decode(GitRepoRequest.serializer(), payload, method)))
            "git.branch.create" -> encode(GitStatusReply.serializer(), engine.createBranch(decode(GitBranchRequest.serializer(), payload, method)))
            "git.branch.delete" -> encode(GitStatusReply.serializer(), engine.deleteBranch(decode(GitBranchRequest.serializer(), payload, method)))
            "git.checkout" -> encode(GitStatusReply.serializer(), engine.checkout(decode(GitCheckoutRequest.serializer(), payload, method)))
            "git.remote.list" -> encode(GitRemoteListReply.serializer(), engine.remotes(decode(GitRepoRequest.serializer(), payload, method)))
            "git.remote.set" -> encode(GitRemoteListReply.serializer(), engine.setRemote(decode(GitRemoteSetRequest.serializer(), payload, method)))
            "git.remote.remove" -> encode(GitRemoteListReply.serializer(), engine.removeRemote(decode(GitRemoteSetRequest.serializer(), payload, method)))
            "git.clone" -> encode(GitStatusReply.serializer(), engine.clone(decode(GitCloneRequest.serializer(), payload, method), sink))
            "git.fetch" -> encode(GitSyncReply.serializer(), engine.fetch(decode(GitSyncRequest.serializer(), payload, method), sink))
            "git.pull" -> encode(GitSyncReply.serializer(), engine.pull(decode(GitSyncRequest.serializer(), payload, method), sink))
            "git.push" -> encode(GitSyncReply.serializer(), engine.push(decode(GitSyncRequest.serializer(), payload, method), sink))
            "git.cancel" -> {
                val request = decode(GitCancelRequest.serializer(), payload, method)
                encode(GitCancelReply.serializer(), GitCancelReply(engine.cancel(request.opId)))
            }
            "git.conflict" -> encode(GitConflictReply.serializer(), engine.conflict(decode(GitConflictRequest.serializer(), payload, method)))
            "git.resolve" -> encode(GitStatusReply.serializer(), engine.resolve(decode(GitResolveRequest.serializer(), payload, method)))
            else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
        }

    private fun <T> decode(
        serializer: kotlinx.serialization.DeserializationStrategy<T>,
        payload: JsonObject,
        method: String
    ): T = json.decodePayload(serializer, payload, method)

    private fun <T> encode(
        serializer: kotlinx.serialization.SerializationStrategy<T>,
        value: T
    ): JsonElement = json.encodeToJsonElement(serializer, value)
}
