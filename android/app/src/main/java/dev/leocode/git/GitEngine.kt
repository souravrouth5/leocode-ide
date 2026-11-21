package dev.leocode.git

import dev.leocode.bridge.BridgeException
import dev.leocode.bridge.ErrorCode
import dev.leocode.bridge.GitAuth
import dev.leocode.bridge.GitBranchInfo
import dev.leocode.bridge.GitBranchListReply
import dev.leocode.bridge.GitBranchRequest
import dev.leocode.bridge.GitCheckoutRequest
import dev.leocode.bridge.GitCloneRequest
import dev.leocode.bridge.GitCommitInfo
import dev.leocode.bridge.GitCommitReply
import dev.leocode.bridge.GitCommitRequest
import dev.leocode.bridge.GitConflictReply
import dev.leocode.bridge.GitConflictRequest
import dev.leocode.bridge.GitDiffReply
import dev.leocode.bridge.GitDiffRequest
import dev.leocode.bridge.GitFileChange
import dev.leocode.bridge.GitInitRequest
import dev.leocode.bridge.GitLogReply
import dev.leocode.bridge.GitLogRequest
import dev.leocode.bridge.GitPathsRequest
import dev.leocode.bridge.GitProgress
import dev.leocode.bridge.GitRemoteInfo
import dev.leocode.bridge.GitRemoteListReply
import dev.leocode.bridge.GitRemoteSetRequest
import dev.leocode.bridge.GitRepoRequest
import dev.leocode.bridge.GitResolveRequest
import dev.leocode.bridge.GitStatusReply
import dev.leocode.bridge.GitSyncReply
import dev.leocode.bridge.GitSyncRequest
import dev.leocode.bridge.StreamSink
import dev.leocode.core.secrets.FileSecretStore
import dev.leocode.ssh.HostKeyPrompts
import dev.leocode.ssh.KnownHostsStore
import dev.leocode.ssh.LeoSshSessionFactory
import dev.leocode.ssh.SshKeyStore
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.security.KeyPair
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.serialization.json.Json
import org.eclipse.jgit.api.CheckoutCommand
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.api.ListBranchCommand
import org.eclipse.jgit.api.MergeResult
import org.eclipse.jgit.api.TransportConfigCallback
import org.eclipse.jgit.api.errors.CheckoutConflictException
import org.eclipse.jgit.api.errors.EmptyCommitException
import org.eclipse.jgit.api.errors.GitAPIException
import org.eclipse.jgit.api.errors.RefNotFoundException
import org.eclipse.jgit.diff.DiffFormatter
import org.eclipse.jgit.dircache.DirCacheIterator
import org.eclipse.jgit.lib.Constants
import org.eclipse.jgit.lib.ObjectId
import org.eclipse.jgit.lib.PersonIdent
import org.eclipse.jgit.lib.ProgressMonitor
import org.eclipse.jgit.lib.Ref
import org.eclipse.jgit.lib.Repository
import org.eclipse.jgit.revwalk.RevSort
import org.eclipse.jgit.revwalk.RevWalk
import org.eclipse.jgit.transport.CredentialsProvider
import org.eclipse.jgit.transport.PushResult
import org.eclipse.jgit.transport.RefSpec
import org.eclipse.jgit.transport.RemoteRefUpdate
import org.eclipse.jgit.transport.SshTransport
import org.eclipse.jgit.transport.Transport
import org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider
import org.eclipse.jgit.treewalk.AbstractTreeIterator
import org.eclipse.jgit.treewalk.CanonicalTreeParser
import org.eclipse.jgit.treewalk.FileTreeIterator
import org.eclipse.jgit.treewalk.filter.PathFilter

/**
 * Local and network Git operations for the bridge (Tasks 21–22).
 *
 * All paths are resolved against the active workspace and must stay inside it.
 * Network operations report progress through the request's [StreamSink], can be
 * cancelled by a client-generated `opId`, and reply only when they finish.
 * Tokens and private keys are read from the secret/key stores at call time and
 * never appear in a reply, a progress event or a log line.
 */
class GitEngine(
    private val workspaceRoot: () -> File,
    private val secrets: FileSecretStore,
    private val keyStore: SshKeyStore,
    private val knownHosts: KnownHostsStore,
    private val prompts: HostKeyPrompts,
    private val json: Json
) {

    companion object {
        const val MAX_LOG = 200
        const val MAX_DIFF_BYTES = 262_144
        private const val TOKEN_PREFIX = "token:"
        private const val AUTH_KIND_KEY = "leocodeAuthKind"
        private const val USERNAME_KEY = "leocodeUsername"
        private const val KEY_ID_KEY = "leocodeKeyId"
        private const val PROGRESS_INTERVAL_MS = 150L
    }

    private val activeOps = ConcurrentHashMap<String, AtomicBoolean>()

    // ------------------------------------------------------------------ status

    fun status(request: GitRepoRequest): GitStatusReply = status(request.path)

    fun status(rawPath: String?): GitStatusReply {
        val dir = repoDir(rawPath)
        val git = try {
            Git.open(dir)
        } catch (_: IOException) {
            return GitStatusReply(initialized = false, root = dir.path)
        }
        return git.use { statusOf(it) }
    }

    fun init(request: GitInitRequest): GitStatusReply {
        val dir = repoDir(request.path)
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
            throw BridgeException(ErrorCode.E_IO, "cannot create the repository directory")
        }
        try {
            Git.init()
                .setDirectory(dir)
                .setInitialBranch(request.branch?.trim().takeUnless { it.isNullOrEmpty() } ?: "main")
                .call()
                .close()
        } catch (e: Exception) {
            throw mapError(e, null)
        }
        return status(request.path)
    }

    fun add(request: GitPathsRequest): GitStatusReply = mutate(request.path) { git ->
        val paths = validPaths(request.paths)
        if (paths.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "paths is required")
        val command = git.add()
        for (path in paths) command.addFilepattern(path)
        command.call()
    }

    fun reset(request: GitPathsRequest): GitStatusReply = mutate(request.path) { git ->
        val paths = validPaths(request.paths)
        if (paths.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "paths is required")
        val command = git.reset()
        for (path in paths) command.addPath(path)
        command.call()
    }

    fun commit(request: GitCommitRequest): GitCommitReply {
        val git = requireRepo(request.path)
        return git.use {
            val message = request.message?.trim().orEmpty()
            if (message.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "message is required")
            val name = request.authorName?.trim().takeUnless { it.isNullOrEmpty() }
                ?: it.repository.config.getString("user", null, "name")
                ?: "LeoCode"
            val email = request.authorEmail?.trim().takeUnless { it.isNullOrEmpty() }
                ?: it.repository.config.getString("user", null, "email")
                ?: "leocode@localhost"
            try {
                val ident = PersonIdent(name, email)
                val commit = it.commit()
                    .setMessage(message)
                    .setAuthor(ident)
                    .setCommitter(ident)
                    .call()
                GitCommitReply(
                    sha = commit.name,
                    shortSha = commit.name.take(7)
                )
            } catch (_: EmptyCommitException) {
                throw BridgeException(
                    ErrorCode.E_CONFLICT,
                    "Nothing is staged; stage a file before committing"
                )
            } catch (e: Exception) {
                throw mapError(e, null)
            }
        }
    }

    fun diff(request: GitDiffRequest): GitDiffReply {
        val git = requireRepo(request.path)
        return git.use {
            val file = request.file?.let { sanitizePath(it) }
            val out = ByteArrayOutputStream()
            try {
                val command = it.diff()
                    .setCached(request.staged)
                    .setOutputStream(out)
                if (file != null) command.setPathFilter(PathFilter.create(file))
                command.call()
            } catch (e: Exception) {
                throw mapError(e, null)
            }
            val bytes = out.toByteArray()
            val text = String(bytes, Charsets.UTF_8)
            val binary = text.contains("Binary files") || text.contains("GIT binary patch")
            val truncated = bytes.size > request.maxBytes.coerceAtLeast(1024)
            val limit = request.maxBytes.coerceIn(1024, MAX_DIFF_BYTES)
            val capped = if (text.length > limit) text.substring(0, limit) else text
            GitDiffReply(
                file = file,
                diff = if (binary) "" else capped,
                truncated = truncated || capped.length < text.length,
                binary = binary
            )
        }
    }

    fun log(request: GitLogRequest): GitLogReply {
        val git = requireRepo(request.path)
        return git.use {
            val max = request.max.coerceIn(1, MAX_LOG)
            try {
                val commits = it.log().setMaxCount(max).call().map { commit ->
                    GitCommitInfo(
                        sha = commit.name,
                        shortSha = commit.name.take(7),
                        author = commit.authorIdent.name,
                        email = commit.authorIdent.emailAddress,
                        time = commit.commitTime.toLong() * 1000,
                        message = commit.shortMessage
                    )
                }
                GitLogReply(commits)
            } catch (e: Exception) {
                // An empty repository has no HEAD; log is an empty list, not an error.
                if (it.repository.resolve(Constants.HEAD) == null) GitLogReply()
                else throw mapError(e, null)
            }
        }
    }

    fun branches(request: GitRepoRequest): GitBranchListReply {
        val git = requireRepo(request.path)
        return git.use {
            val current = it.repository.branch ?: ""
            val branches = try {
                it.branchList().setListMode(ListBranchCommand.ListMode.ALL).call()
                    .map { ref -> ref.toInfo(current) }
            } catch (e: Exception) {
                throw mapError(e, null)
            }
            GitBranchListReply(branches = branches, current = current)
        }
    }

    fun createBranch(request: GitBranchRequest): GitStatusReply = mutate(request.path) { git ->
        val name = request.name?.trim().orEmpty()
        if (name.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "name is required")
        try {
            git.branchCreate().setName(name).apply {
                request.startPoint?.takeIf { it.isNotBlank() }?.let { setStartPoint(it) }
            }.call()
        } catch (e: Exception) {
            throw mapError(e, null)
        }
    }

    fun deleteBranch(request: GitBranchRequest): GitStatusReply {
        val git = requireRepo(request.path)
        return git.use {
            val name = request.name?.trim().orEmpty()
            if (name.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "name is required")
            if (name == it.repository.branch) {
                throw BridgeException(ErrorCode.E_BUSY, "cannot delete the checked-out branch")
            }
            try {
                it.branchDelete().setBranchNames(name).setForce(false).call()
            } catch (e: Exception) {
                throw mapError(e, null)
            }
        }.let { status(request.path) }
    }

    fun checkout(request: GitCheckoutRequest): GitStatusReply {
        val git = requireRepo(request.path)
        try {
            git.use {
                val name = request.name?.trim().orEmpty()
                if (name.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "name is required")
                it.checkout().setName(name).setCreateBranch(request.create).call()
            }
        } catch (e: CheckoutConflictException) {
            throw BridgeException(
                ErrorCode.E_CONFLICT,
                "Local changes would be overwritten; commit or discard them first"
            )
        } catch (e: BridgeException) {
            throw e
        } catch (e: Exception) {
            throw mapError(e, null)
        }
        return status(request.path)
    }

    // ----------------------------------------------------------------- remotes

    fun remotes(request: GitRepoRequest): GitRemoteListReply {
        val git = requireRepo(request.path)
        return git.use { remoteListOf(it) }
    }

    fun setRemote(request: GitRemoteSetRequest): GitRemoteListReply {
        val git = requireRepo(request.path)
        return git.use {
            val name = request.name?.trim().orEmpty()
            val url = request.url?.trim().orEmpty()
            if (name.isEmpty() || url.isEmpty()) {
                throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "name and url are required")
            }
            val config = it.repository.config
            config.setString("remote", name, "url", url)
            if (config.getString("remote", name, "fetch") == null) {
                config.setString("remote", name, "fetch", "+refs/heads/*:refs/remotes/$name/*")
            }
            val authKind = request.authKind?.trim()?.takeIf { it.isNotEmpty() } ?: "none"
            config.setString("remote", name, AUTH_KIND_KEY, authKind)
            if (request.username.isNullOrBlank()) config.unset("remote", name, USERNAME_KEY)
            else config.setString("remote", name, USERNAME_KEY, request.username.trim())
            if (request.keyId.isNullOrBlank()) config.unset("remote", name, KEY_ID_KEY)
            else config.setString("remote", name, KEY_ID_KEY, request.keyId.trim())

            val host = hostOf(url)
            if (request.token != null && host != null) {
                if (request.token.isEmpty()) secrets.delete(TOKEN_PREFIX + host)
                else secrets.put(TOKEN_PREFIX + host, request.token.toByteArray())
            }
            try {
                config.save()
            } catch (e: IOException) {
                throw BridgeException(ErrorCode.E_IO, "cannot save the remote configuration")
            }
            remoteListOf(it)
        }
    }

    fun removeRemote(request: GitRemoteSetRequest): GitRemoteListReply {
        val git = requireRepo(request.path)
        return git.use {
            val name = request.name?.trim().orEmpty()
            if (name.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "name is required")
            try {
                it.remoteRemove().setRemoteName(name).call()
            } catch (e: Exception) {
                throw mapError(e, null)
            }
            remoteListOf(it)
        }
    }

    // ---------------------------------------------------------------- network

    fun clone(request: GitCloneRequest, sink: StreamSink): GitStatusReply {
        val url = request.url?.trim().orEmpty()
        if (url.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "url is required")
        val target = request.path?.trim().takeUnless { it.isNullOrEmpty() }
            ?: request.name?.trim().takeUnless { it.isNullOrEmpty() }
            ?: repoNameOf(url)
        val dir = repoDir(target)
        if (dir.exists() && dir.list()?.isNotEmpty() == true) {
            throw BridgeException(ErrorCode.E_EXISTS, "the destination directory is not empty")
        }
        val auth = authFor(url, request.auth, null, sink)
        try {
            withProgress("clone", request.opId, sink) { monitor ->
                Git.cloneRepository()
                    .setURI(url)
                    .setDirectory(dir)
                    .setProgressMonitor(monitor)
                    .setTransportConfigCallback(auth.callback)
                    .apply { auth.credentials?.let { setCredentialsProvider(it) } }
                    .call()
                    .close()
            }
        } catch (e: Exception) {
            throw mapError(e, auth.factory)
        }
        return status(relativePath(dir))
    }

    fun fetch(request: GitSyncRequest, sink: StreamSink): GitSyncReply {
        val git = requireRepo(request.path)
        return git.use { repo ->
            val remote = remoteName(repo.repository, request.remote)
            val url = remoteUrl(repo.repository, remote)
            val auth = authFor(url, request.auth, remoteConfig(repo.repository, remote), sink)
            try {
                withProgress("fetch", request.opId, sink) { monitor ->
                    repo.fetch()
                        .setRemote(remote)
                        .setProgressMonitor(monitor)
                        .setTransportConfigCallback(auth.callback)
                        .apply { auth.credentials?.let { setCredentialsProvider(it) } }
                        .call()
                }
            } catch (e: Exception) {
                throw mapError(e, auth.factory)
            }
            syncReply(repo.repository, "Fetched $remote")
        }
    }

    fun pull(request: GitSyncRequest, sink: StreamSink): GitSyncReply {
        val git = requireRepo(request.path)
        return git.use { repo ->
            val remote = remoteName(repo.repository, request.remote)
            val url = remoteUrl(repo.repository, remote)
            val auth = authFor(url, request.auth, remoteConfig(repo.repository, remote), sink)
            try {
                val result = withProgress("pull", request.opId, sink) { monitor ->
                    repo.pull()
                        .setRemote(remote)
                        .setProgressMonitor(monitor)
                        .setTransportConfigCallback(auth.callback)
                        .apply { auth.credentials?.let { setCredentialsProvider(it) } }
                        .apply {
                            request.branch?.trim()?.takeIf { it.isNotEmpty() }
                                ?.let { setRemoteBranchName(it) }
                        }
                        .call()
                }
                if (result.mergeResult?.mergeStatus == MergeResult.MergeStatus.CONFLICTING) {
                    throw BridgeException(
                        ErrorCode.E_CONFLICT,
                        "Pull produced conflicts; resolve them in the Git tab"
                    )
                }
            } catch (e: BridgeException) {
                throw e
            } catch (e: Exception) {
                throw mapError(e, auth.factory)
            }
            syncReply(repo.repository, "Pulled from $remote")
        }
    }

    fun push(request: GitSyncRequest, sink: StreamSink): GitSyncReply {
        val git = requireRepo(request.path)
        return git.use { repo ->
            val remote = remoteName(repo.repository, request.remote)
            val url = remoteUrl(repo.repository, remote)
            val auth = authFor(url, request.auth, remoteConfig(repo.repository, remote), sink)
            val branch = request.branch?.trim()?.takeIf { it.isNotEmpty() }
            try {
                val results = withProgress("push", request.opId, sink) { monitor ->
                    repo.push()
                        .setRemote(remote)
                        .setProgressMonitor(monitor)
                        .setForce(request.force)
                        .setTransportConfigCallback(auth.callback)
                        .apply { auth.credentials?.let { setCredentialsProvider(it) } }
                        .apply {
                            if (branch != null) {
                                setRefSpecs(RefSpec("HEAD:refs/heads/$branch"))
                            }
                        }
                        .call()
                }
                checkPushResults(results)
            } catch (e: BridgeException) {
                throw e
            } catch (e: Exception) {
                throw mapError(e, auth.factory)
            }
            syncReply(repo.repository, "Pushed to $remote")
        }
    }

    fun cancel(opId: String?): Boolean {
        val flag = opId?.let { activeOps[it] } ?: return false
        flag.set(true)
        return true
    }

    /** Cancels every running network operation; used when the bridge detaches. */
    fun cancelAll() {
        for (flag in activeOps.values) flag.set(true)
    }

    // --------------------------------------------------------------- conflicts

    fun conflict(request: GitConflictRequest): GitConflictReply {
        val git = requireRepo(request.path)
        return git.use { repo ->
            val file = sanitizePath(request.file ?: "")
            if (file.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "file is required")
            val path = File(repo.repository.workTree, file)
            if (!path.isFile) throw BridgeException(ErrorCode.E_NOT_FOUND, "file is missing")
            val bytes = try {
                path.readBytes()
            } catch (_: IOException) {
                throw BridgeException(ErrorCode.E_IO, "cannot read the conflicted file")
            }
            val binary = bytes.take(8_000).any { it == 0.toByte() }
            if (binary) {
                GitConflictReply(file = file, binary = true)
            } else {
                parseConflict(file, String(bytes, Charsets.UTF_8))
            }
        }
    }

    fun resolve(request: GitResolveRequest): GitStatusReply {
        val git = requireRepo(request.path)
        try {
            git.use { repo ->
                val file = sanitizePath(request.file ?: "")
                if (file.isEmpty()) throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "file is required")
                val stage = when (request.strategy?.lowercase()) {
                    "ours" -> CheckoutCommand.Stage.OURS
                    "theirs" -> CheckoutCommand.Stage.THEIRS
                    else -> throw BridgeException(
                        ErrorCode.E_BAD_ENVELOPE,
                        "strategy is ours or theirs"
                    )
                }
                repo.checkout().setStage(stage).addPath(file).call()
                repo.add().addFilepattern(file).call()
            }
        } catch (e: BridgeException) {
            throw e
        } catch (e: Exception) {
            throw mapError(e, null)
        }
        return status(request.path)
    }

    // ------------------------------------------------------------------ helpers

    private fun mutate(path: String?, block: (Git) -> Unit): GitStatusReply {
        val git = requireRepo(path)
        try {
            git.use(block)
        } catch (e: BridgeException) {
            throw e
        } catch (e: Exception) {
            throw mapError(e, null)
        }
        return status(path)
    }

    private fun requireRepo(rawPath: String?): Git {
        val dir = repoDir(rawPath)
        return try {
            Git.open(dir)
        } catch (_: IOException) {
            throw BridgeException(ErrorCode.E_NOT_FOUND, "not a git repository")
        }
    }

    private fun repoDir(rawPath: String?): File {
        val root = try {
            workspaceRoot().canonicalFile
        } catch (_: IOException) {
            throw BridgeException(ErrorCode.E_IO, "workspace is unavailable")
        }
        if (rawPath.isNullOrBlank() || rawPath == ".") return root
        val candidate = try {
            File(root, rawPath).canonicalFile
        } catch (_: IOException) {
            throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "invalid path")
        }
        if (candidate != root && !candidate.path.startsWith(root.path + File.separator)) {
            throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "path is outside the workspace")
        }
        return candidate
    }

    private fun relativePath(file: File): String? {
        val root = workspaceRoot().canonicalFile
        val target = file.canonicalFile
        if (target == root) return null
        return target.path.removePrefix(root.path + File.separator)
    }

    /** Repo-relative file path; rejects absolute paths and `..` escapes. */
    private fun sanitizePath(raw: String): String {
        val normalized = raw.trim().replace('\\', '/')
        if (normalized.isEmpty()) return ""
        if (normalized.startsWith("/")) {
            throw BridgeException(ErrorCode.E_BAD_ENVELOPE, "paths are repository-relative")
        }
        val parts = ArrayDeque<String>()
        for (part in normalized.split('/')) {
            when (part) {
                "", "." -> Unit
                ".." -> return throw BridgeException(
                    ErrorCode.E_BAD_ENVELOPE,
                    "paths are repository-relative"
                )
                else -> parts.addLast(part)
            }
        }
        return parts.joinToString("/")
    }

    private fun validPaths(paths: List<String>): List<String> =
        paths.map { sanitizePath(it) }.filter { it.isNotEmpty() }.distinct()

    private fun statusOf(git: Git): GitStatusReply = statusOf(git.repository)

    private fun statusOf(repo: Repository): GitStatusReply {
        // The wrapper is not closed: the caller still owns [repo]. Git itself is
        // a thin command factory, so leaving it to the GC is safe here.
        val status = Git(repo).status().call()
        val branch = repo.branch ?: ""
        val head = repo.resolve(Constants.HEAD)?.name?.take(7)
        val upstreamRef = trackingRef(repo)
        val (ahead, behind) = if (upstreamRef == null) 0 to 0 else aheadBehind(repo, upstreamRef)

        val staged = status.added.map { it.toChange("added") } +
            status.changed.map { it.toChange("modified") } +
            status.removed.map { it.toChange("deleted") }
        val changed = status.modified.map { it.toChange("modified") } +
            status.missing.map { it.toChange("deleted") }
        val untracked = status.untracked.map { it.toChange("untracked") }
        val conflicts = status.conflicting.map { it.toChange("conflicted") }
        val clean = staged.isEmpty() && changed.isEmpty() &&
            untracked.isEmpty() && conflicts.isEmpty()

        return GitStatusReply(
            initialized = true,
            root = repo.workTree.canonicalPath,
            branch = branch,
            head = head,
            upstream = upstreamRef?.let { shortTracking(it) },
            remote = repo.config.getString("branch", branch, "remote"),
            ahead = ahead,
            behind = behind,
            staged = staged.sortedBy { it.path },
            changed = changed.sortedBy { it.path },
            untracked = untracked.sortedBy { it.path },
            conflicts = conflicts.sortedBy { it.path },
            clean = clean
        )
    }

    private fun String.toChange(status: String) = GitFileChange(path = this, status = status)

    private fun trackingRef(repo: Repository): String? {
        val branch = repo.branch ?: return null
        val remote = repo.config.getString("branch", branch, "remote") ?: return null
        val merge = repo.config.getString("branch", branch, "merge") ?: return null
        val short = Repository.shortenRefName(merge)
        return "refs/remotes/$remote/$short"
    }

    private fun shortTracking(ref: String): String =
        ref.removePrefix("refs/remotes/")

    private fun aheadBehind(repo: Repository, upstreamRef: String): Pair<Int, Int> {
        val local = repo.resolve(Constants.HEAD) ?: return 0 to 0
        val upstream = repo.resolve(upstreamRef) ?: return 0 to 0
        return try {
            count(repo, local, upstream) to count(repo, upstream, local)
        } catch (_: IOException) {
            0 to 0
        } catch (_: GitAPIException) {
            0 to 0
        }
    }

    private fun count(repo: Repository, include: ObjectId, exclude: ObjectId): Int =
        RevWalk(repo).use { walk ->
            walk.sort(RevSort.TOPO)
            walk.markStart(walk.parseCommit(include))
            walk.markUninteresting(walk.parseCommit(exclude))
            var total = 0
            while (walk.next() != null) total++
            total
        }

    private fun Ref.toInfo(current: String): GitBranchInfo {
        val short = Repository.shortenRefName(name)
        val remote = name.startsWith(Constants.R_REMOTES)
        val display = if (remote) {
            val slash = short.indexOf('/')
            if (slash > 0) short.substring(slash + 1) else short
        } else {
            short
        }
        return GitBranchInfo(
            name = display,
            current = !remote && short == current,
            remote = remote,
            sha = objectId?.name ?: ""
        )
    }

    private fun remoteListOf(git: Git): GitRemoteListReply {
        val repo = git.repository
        val config = repo.config
        val current = repo.config.getString("branch", repo.branch ?: "", "remote")
        val remotes = config.getSubsections("remote").sorted().map { name ->
            val url = config.getString("remote", name, "url").orEmpty()
            val host = hostOf(url)
            GitRemoteInfo(
                name = name,
                url = url,
                authKind = config.getString("remote", name, AUTH_KIND_KEY) ?: "none",
                username = config.getString("remote", name, USERNAME_KEY),
                hasToken = host != null && secrets.has(TOKEN_PREFIX + host),
                keyId = config.getString("remote", name, KEY_ID_KEY)
            )
        }
        return GitRemoteListReply(remotes = remotes, current = current)
    }

    private fun remoteConfig(repo: Repository, name: String): GitRemoteInfo? =
        if (repo.config.getString("remote", name, "url") == null) null else GitRemoteInfo(
            name = name,
            url = repo.config.getString("remote", name, "url").orEmpty(),
            authKind = repo.config.getString("remote", name, AUTH_KIND_KEY) ?: "none",
            username = repo.config.getString("remote", name, USERNAME_KEY),
            keyId = repo.config.getString("remote", name, KEY_ID_KEY)
        )

    private fun remoteName(repo: Repository, requested: String?): String {
        requested?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        val branch = repo.branch
        if (branch != null) {
            repo.config.getString("branch", branch, "remote")?.let { return it }
        }
        return repo.config.getSubsections("remote").firstOrNull() ?: "origin"
    }

    private fun remoteUrl(repo: Repository, name: String): String =
        repo.config.getString("remote", name, "url")
            ?: throw BridgeException(ErrorCode.E_NOT_FOUND, "remote $name is not configured")

    private fun syncReply(repo: Repository, message: String): GitSyncReply {
        val status = statusOf(repo)
        return GitSyncReply(
            branch = status.branch,
            ahead = status.ahead,
            behind = status.behind,
            message = message
        )
    }

    private fun checkPushResults(results: Iterable<PushResult>) {
        for (result in results) {
            for (update in result.remoteUpdates) {
                when (update.status) {
                    RemoteRefUpdate.Status.OK, RemoteRefUpdate.Status.UP_TO_DATE -> Unit
                    RemoteRefUpdate.Status.REJECTED_NONFASTFORWARD,
                    RemoteRefUpdate.Status.REJECTED_REMOTE_CHANGED -> throw BridgeException(
                        ErrorCode.E_CONFLICT,
                        "The remote has commits you do not have; pull before pushing"
                    )
                    else -> throw BridgeException(
                        ErrorCode.E_IO,
                        update.message ?: "the remote rejected the push"
                    )
                }
            }
        }
    }

    // -------------------------------------------------------------------- auth

    private class Auth(
        val credentials: CredentialsProvider?,
        val callback: TransportConfigCallback,
        val factory: LeoSshSessionFactory?
    )

    private fun authFor(
        url: String,
        request: GitAuth?,
        stored: GitRemoteInfo?,
        sink: StreamSink
    ): Auth {
        val kind = request?.kind?.takeIf { it != "none" }
            ?: stored?.authKind?.takeIf { it != "none" }
            ?: if (url.startsWith("http://") || url.startsWith("https://")) "https" else "ssh"
        if (kind == "ssh") {
            val keyId = request?.keyId?.takeIf { it.isNotBlank() }
                ?: stored?.keyId?.takeIf { it.isNotBlank() }
            if (keyId != null) {
                val pair: KeyPair = try {
                    keyStore.keyPair(keyId, request?.passphrase)
                } catch (e: IOException) {
                    throw BridgeException(ErrorCode.E_AUTH, e.message ?: "cannot use this SSH key")
                }
                val factory = LeoSshSessionFactory(
                    keyPairs = listOf(pair),
                    knownHosts = knownHosts,
                    prompts = prompts,
                    emit = { prompt ->
                        // Runs on MINA's I/O thread, not the request thread, so
                        // the sink must be captured here rather than read from
                        // a per-thread holder.
                        runCatching {
                            sink.event(
                                "ssh.hostkey.prompt",
                                json.encodeToJsonElement(
                                    dev.leocode.bridge.SshHostPrompt.serializer(),
                                    prompt
                                )
                            )
                        }
                    },
                    sshDir = File(sshDirectory(), "ssh")
                )
                return Auth(
                    credentials = null,
                    callback = TransportConfigCallback { transport ->
                        if (transport is SshTransport) transport.sshSessionFactory = factory
                        applyCredentials(transport, kind, request, stored)
                    },
                    factory = factory
                )
            }
            return Auth(
                credentials = null,
                callback = TransportConfigCallback { transport ->
                    applyCredentials(transport, kind, request, stored)
                },
                factory = null
            )
        }

        val host = hostOf(url)
        val username = request?.username?.takeIf { it.isNotBlank() }
            ?: stored?.username?.takeIf { it.isNotBlank() }
            ?: "x-access-token"
        val token = request?.token?.takeIf { it.isNotEmpty() }
            ?: host?.let { secrets.get(TOKEN_PREFIX + it)?.toString(Charsets.UTF_8) }
        val credentials = token?.let { UsernamePasswordCredentialsProvider(username, it) }
        return Auth(
            credentials = credentials,
            callback = TransportConfigCallback { transport ->
                applyCredentials(transport, kind, request, stored)
            },
            factory = null
        )
    }

    private fun applyCredentials(
        transport: Transport,
        kind: String,
        request: GitAuth?,
        stored: GitRemoteInfo?
    ) {
        val token = request?.token?.takeIf { it.isNotEmpty() }
        if (kind == "https" && token != null) {
            val username = request.username?.takeIf { it.isNotBlank() }
                ?: stored?.username?.takeIf { it.isNotBlank() }
                ?: "x-access-token"
            transport.credentialsProvider = UsernamePasswordCredentialsProvider(username, token)
        }
    }

    private fun sshDirectory(): File = keyStore.directory()

    // ----------------------------------------------------------------- progress

    private fun <T> withProgress(
        op: String,
        opId: String?,
        sink: StreamSink,
        block: (ProgressMonitor) -> T
    ): T {
        val key = opId?.trim()?.takeIf { it.isNotEmpty() }
        val flag = AtomicBoolean(false)
        if (key != null) {
            if (activeOps.putIfAbsent(key, flag) != null) {
                throw BridgeException(ErrorCode.E_BUSY, "an operation with this id is already running")
            }
        }
        try {
            val monitor = GitProgressMonitor(op, key, sink, flag)
            val result = block(monitor)
            if (flag.get()) throw BridgeException(ErrorCode.E_CANCELLED, "cancelled")
            return result
        } finally {
            if (key != null) activeOps.remove(key, flag)
        }
    }

    private inner class GitProgressMonitor(
        private val op: String,
        private val opId: String?,
        private val sink: StreamSink,
        private val cancelled: AtomicBoolean
    ) : ProgressMonitor {
        private var task = ""
        private var total = 0
        private var done = 0
        private var lastEmit = 0L

        override fun start(totalWork: Int) {
            total = totalWork
            emit(force = true)
        }

        override fun beginTask(title: String, totalWork: Int) {
            task = title
            total = totalWork
            done = 0
            emit(force = true)
        }

        override fun update(completed: Int) {
            done += completed
            emit(force = false)
        }

        override fun endTask() {
            if (total > 0) done = total
            emit(force = true)
        }

        override fun isCancelled(): Boolean = cancelled.get()

        private fun emit(force: Boolean) {
            val now = System.currentTimeMillis()
            if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return
            lastEmit = now
            runCatching {
                sink.event(
                    "git.progress",
                    json.encodeToJsonElement(
                        GitProgress.serializer(),
                        GitProgress(op = op, opId = opId, task = task, done = done, total = total)
                    )
                )
            }
        }
    }

    // ------------------------------------------------------------------- errors

    private fun mapError(error: Throwable, factory: LeoSshSessionFactory?): BridgeException {
        if (error is BridgeException) return error
        if (factory?.lastDenied == HostKeyPrompts.Result.CHANGED) {
            return BridgeException(
                ErrorCode.E_HOSTKEY_CHANGED,
                "The host key changed; forget the host before trusting the new key"
            )
        }
        if (factory?.lastDenied == HostKeyPrompts.Result.REJECTED) {
            return BridgeException(ErrorCode.E_AUTH, "The host key was not trusted")
        }
        val text = (error.message ?: "").lowercase()
        return when {
            text.contains("not authorized") ||
                text.contains("authentication") ||
                text.contains("auth fail") ||
                text.contains("permission denied") ||
                text.contains("invalid credentials") ->
                BridgeException(ErrorCode.E_AUTH, "Authentication failed; check the token or SSH key")
            text.contains("unknown host") ||
                text.contains("unable to connect") ||
                text.contains("connection refused") ||
                text.contains("network is unreachable") ||
                text.contains("timed out") ||
                text.contains("unreachable") ->
                BridgeException(ErrorCode.E_OFFLINE, "Cannot reach the remote")
            error is RefNotFoundException ->
                BridgeException(ErrorCode.E_NOT_FOUND, "The branch or commit was not found")
            error is CheckoutConflictException ->
                BridgeException(ErrorCode.E_CONFLICT, "Local changes would be overwritten")
            else -> BridgeException(ErrorCode.E_IO, "The Git operation failed")
        }
    }

    private fun parseConflict(file: String, text: String): GitConflictReply {
        val ours = StringBuilder()
        val theirs = StringBuilder()
        val base = StringBuilder()
        var section = 0 // 0 outside, 1 ours, 2 base, 3 theirs
        var sawConflict = false
        for (line in text.lineSequence()) {
            when {
                line.startsWith("<<<<<<<") -> {
                    section = 1
                    sawConflict = true
                }
                line.startsWith("|||||||") -> section = 2
                line.startsWith("=======") && section != 0 -> section = 3
                line.startsWith(">>>>>>>") && section != 0 -> section = 0
                else -> when (section) {
                    0 -> {
                        ours.appendLine(line)
                        theirs.appendLine(line)
                        base.appendLine(line)
                    }
                    1 -> ours.appendLine(line)
                    2 -> base.appendLine(line)
                    else -> theirs.appendLine(line)
                }
            }
        }
        if (!sawConflict) {
            throw BridgeException(ErrorCode.E_CONFLICT, "this file has no conflict markers")
        }
        return GitConflictReply(
            file = file,
            merged = text,
            ours = ours.toString(),
            theirs = theirs.toString(),
            base = base.toString()
        )
    }

    private fun repoNameOf(url: String): String {
        val withoutQuery = url.substringBefore('?').substringBefore('#').trimEnd('/')
        val name = withoutQuery.substringAfterLast('/').substringAfterLast(':').removeSuffix(".git")
        return name.ifBlank { "repository" }
    }

    private fun hostOf(url: String): String? {
        val trimmed = url.trim()
        return try {
            val uri = java.net.URI(trimmed)
            if (uri.host != null) return uri.host
            // scp-like: user@host:path
            val at = trimmed.indexOf('@')
            if (at >= 0) {
                val rest = trimmed.substring(at + 1)
                rest.substringBefore(':').takeIf { it.contains('.') || it == "localhost" }
            } else {
                null
            }
        } catch (_: Exception) {
            null
        }
    }
}
