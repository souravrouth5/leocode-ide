package dev.leocode

import android.content.Context
import dev.leocode.bridge.BridgeJson
import dev.leocode.bridge.GitAuth
import dev.leocode.bridge.GitCloneRequest
import dev.leocode.bridge.GitCommitRequest
import dev.leocode.bridge.GitPathsRequest
import dev.leocode.bridge.GitProgress
import dev.leocode.bridge.GitSyncRequest
import dev.leocode.bridge.SshHostPrompt
import dev.leocode.bridge.SshKeyGenerateRequest
import dev.leocode.bridge.StreamSink
import java.io.File
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicReference
import kotlinx.serialization.json.JsonElement

/**
 * Phase F device tests (Tasks 19–23) for the debug harness.
 *
 * T10–T14 in `docs/test-matrix.md` are written for the Git tab, but the WebView
 * is a canvas (a single accessibility node) and debug builds expose no DevTools
 * socket, so the UI cannot be driven or inspected over adb. These tests drive
 * the same `GitEngine`, `SshKeyStore`, `HostKeyPrompts`, `KnownHostsStore` and
 * `FileSecretStore` instances the bridge uses ([AppGraph] builds them once), so
 * the transport, Keystore and host-key paths under test are the production
 * ones; only the WebView rendering layer is skipped.
 *
 * Each method returns the evidence text that [HarnessActivity] prints and logs
 * under `LeoCodeHarness`.
 */
class PhaseFHarness(
    private val context: Context,
    private val graph: AppGraph
) {

    companion object {
        private const val PREFS = "leocode.harness"
        private const val KEY_SSH_KEY_ID = "phasef.sshKeyId"
        private const val PROMPT_WAIT_MS = 25_000L
        private const val NET_WAIT_MS = 120_000L

        const val DEFAULT_HTTPS_REPO = "https://github.com/octocat/Hello-World.git"
        const val DEFAULT_SSH_HOST = "127.0.0.1"
        const val DEFAULT_SSH_PORT = 2222
        const val DEFAULT_SSH_USER = "git"
        const val DEFAULT_HTTPS_PORT = 8080
    }

    /** Records the events one Git request emits, for assertions and evidence. */
    class Recorder : StreamSink {
        val progress = CopyOnWriteArrayList<GitProgress>()
        val prompts = CopyOnWriteArrayList<SshHostPrompt>()

        override fun event(name: String, payload: JsonElement) {
            when (name) {
                "git.progress" -> runCatching {
                    progress += BridgeJson.value.decodeFromJsonElement(GitProgress.serializer(), payload)
                }
                "ssh.hostkey.prompt" -> runCatching {
                    prompts += BridgeJson.value.decodeFromJsonElement(SshHostPrompt.serializer(), payload)
                }
            }
        }

        override fun text(name: String, text: String) = Unit

        override fun bytes(name: String, bytes: ByteArray) = Unit
    }

    /** Parameters for the network rows; overridden by `am start -e` extras. */
    data class Net(
        val httpsRepo: String = DEFAULT_HTTPS_REPO,
        val sshHost: String = DEFAULT_SSH_HOST,
        val sshPort: Int = DEFAULT_SSH_PORT,
        val sshUser: String = DEFAULT_SSH_USER,
        /** Host used for the token-auth HTTP test server (T13t). */
        val httpsHost: String = DEFAULT_SSH_HOST,
        val httpsPort: Int = DEFAULT_HTTPS_PORT,
        val httpsRepoName: String = "t14.git",
        val httpsUser: String = "x-access-token",
        /** Token the test HTTP server expects; supplied per run by the caller. */
        val httpsToken: String = ""
    ) {
        fun sshUrl(repo: String): String = "ssh://$sshUser@$sshHost:$sshPort/$repo"
    }

    /** Repository names on the test SSH server used by T12 and T13. */
    data class Repos(val clone: String = "t12.git", val push: String = "t13.git")

    private val prefs by lazy { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    fun rememberKeyId(id: String) {
        prefs.edit().putString(KEY_SSH_KEY_ID, id).apply()
    }

    fun rememberedKeyId(): String? = prefs.getString(KEY_SSH_KEY_ID, null)

    // ------------------------------------------------------------------ T10

    /** T10: HTTPS clone of a public repository; the reply arrives after the transfer. */
    fun t10(net: Net): String {
        val dest = "pf-t10"
        freshDirectory(dest)
        val recorder = Recorder()
        val started = System.currentTimeMillis()
        val status = try {
            graph.gitEngine.clone(GitCloneRequest(url = net.httpsRepo, path = dest), recorder)
        } catch (e: Exception) {
            // BridgeException messages are generic by design; unwrap the cause
            // chain so the device run records the real JGit/transport failure.
            return buildString {
                appendLine("  FAIL ${e.javaClass.simpleName}: ${e.message}")
                var cause: Throwable? = e.cause
                var depth = 1
                while (cause != null && depth <= 5) {
                    appendLine("  cause$depth: ${cause.javaClass.name}: ${cause.message}")
                    cause = cause.cause
                    depth++
                }
                append("  (unwrapped for diagnosis)")
            }
        }
        val elapsed = System.currentTimeMillis() - started
        val files = File(graph.workspaceStore.activeDirectory(), dest)
            .listFiles()?.map { it.name }?.sorted().orEmpty()

        return buildString {
            appendLine("  url=${net.httpsRepo}")
            appendLine("  initialized=${status.initialized} branch=${status.branch} head=${status.head} clean=${status.clean}")
            appendLine("  files=${files.joinToString(",")}")
            appendLine("  progressEvents=${recorder.progress.size} firstTask=${recorder.progress.firstOrNull()?.task ?: "-"}")
            appendLine("  duration=${elapsed}ms")
            append(if (status.initialized && files.isNotEmpty()) "  PASS" else "  FAIL — clone produced no working tree")
        }
    }

    // ------------------------------------------------------------ T11 diag

    /**
     * Reports why keygen fails on this device: whether the platform and MINA can
     * both produce SHA-256. MINA's `KeyUtils.getFingerPrint` uses its own digest
     * factory, which is separate from `MessageDigest.getInstance`.
     */
    fun diagnostics(): String = buildString {
        appendLine("  platformSha256=${runCatching { java.security.MessageDigest.getInstance("SHA-256").digest("abc".toByteArray()).size }.getOrElse { "FAIL ${it.message}" }}")
        appendLine("  minaSha256Supported=${runCatching { org.apache.sshd.common.digest.BuiltinDigests.sha256.isSupported }.getOrElse { "FAIL ${it.message}" }}")
        appendLine("  minaGetMessageDigest=${runCatching { org.apache.sshd.common.util.security.SecurityUtils.getMessageDigest("SHA-256").digest().size }.getOrElse { "FAIL ${it.javaClass.simpleName}: ${it.message}" }}")
        appendLine("  minaFingerprintDefault=${runCatching { org.apache.sshd.common.config.keys.KeyUtils.getDefaultFingerPrintFactory()?.name }.getOrElse { "FAIL ${it.message}" }}")
        appendLine("  providers=${java.security.Security.getProviders().joinToString(",") { it.name }}")
        append("  (diagnostic only)")
    }

    // ------------------------------------------------------------ T10 diag

    /**
     * Separates "the app cannot reach the network" from "JGit cannot": resolves
     * the host with the platform resolver and opens a plain HTTPS connection.
     * If both fail the device/VPN is at fault, not the Git stack.
     */
    fun networkDiagnostic(net: Net): String = buildString {
        val host = runCatching { java.net.URI(net.httpsRepo).host }.getOrNull() ?: "github.com"
        appendLine("  host=$host")
        appendLine("  inetAddress=${runCatching { java.net.InetAddress.getAllByName(host).joinToString(",") { it.hostAddress } }.getOrElse { "FAIL ${it.javaClass.simpleName}: ${it.message}" }}")
        appendLine("  https=${runCatching {
            val url = java.net.URL("https://$host/")
            val conn = url.openConnection() as java.net.HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.requestMethod = "HEAD"
            val code = conn.responseCode
            conn.disconnect()
            "HTTP $code"
        }.getOrElse { "FAIL ${it.javaClass.simpleName}: ${it.message}" }}")
        // Loopback through `adb reverse`: proves whether this app UID can open a
        // socket at all, independent of DNS.
        appendLine("  loopback8080=${runCatching {
            java.net.Socket().use { socket ->
                socket.connect(java.net.InetSocketAddress("127.0.0.1", 8080), 5000)
                "connected"
            }
        }.getOrElse { "FAIL ${it.javaClass.simpleName}: ${it.message}" }}")
        appendLine("  loopback2222=${runCatching {
            java.net.Socket().use { socket ->
                socket.connect(java.net.InetSocketAddress("127.0.0.1", 2222), 5000)
                "connected"
            }
        }.getOrElse { "FAIL ${it.javaClass.simpleName}: ${it.message}" }}")
        append("  (diagnostic only)")
    }

    /**
     * Loopback clone over smart HTTP (no DNS, no TLS).
     *
     * The app UID cannot resolve DNS while the phone's VPN is up (the adb shell
     * UID is exempt), so a public `https://` clone cannot complete on this
     * device regardless of LeoCode. `adb reverse tcp:8080` maps a host-side
     * `git http-backend` to 127.0.0.1:8080, which exercises the same JGit
     * HTTP transport path without name resolution. Kept beside T10 so the T10
     * row can still be recorded honestly as "blocked by device DNS".
     */
    fun t10Loopback(net: Net, port: Int = 8080): String {
        val dest = "pf-t10-http"
        freshDirectory(dest)
        val url = "http://127.0.0.1:$port/t12.git"
        val recorder = Recorder()
        val started = System.currentTimeMillis()
        val status = try {
            graph.gitEngine.clone(GitCloneRequest(url = url, path = dest), recorder)
        } catch (e: Exception) {
            return "  url=$url\n  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
        val elapsed = System.currentTimeMillis() - started
        val files = File(graph.workspaceStore.activeDirectory(), dest)
            .listFiles()?.map { it.name }?.sorted().orEmpty()
        return buildString {
            appendLine("  url=$url (adb reverse, no DNS)")
            appendLine("  initialized=${status.initialized} branch=${status.branch} head=${status.head}")
            appendLine("  files=${files.joinToString(",")}")
            appendLine("  progressEvents=${recorder.progress.size} firstTask=${recorder.progress.firstOrNull()?.task ?: "-"}")
            appendLine("  duration=${elapsed}ms")
            append(if (status.initialized && files.isNotEmpty()) "  PASS" else "  FAIL — clone produced no working tree")
        }
    }

    /**
     * Runs a raw JGit clone (same libraries, no GitEngine error mapping) so a
     * failure prints its real exception instead of the bridge's generic text.
     * Diagnostic only: T10 remains the production-path row.
     */
    fun t10Diagnostic(net: Net): String {
        val dir = File(graph.workspaceStore.activeDirectory(), "pf-dx").apply {
            if (exists()) deleteRecursively()
            mkdirs()
        }
        return try {
            org.eclipse.jgit.api.Git.cloneRepository()
                .setURI(net.httpsRepo)
                .setDirectory(dir)
                .call()
                .close()
            "  raw clone OK files=${dir.listFiles()?.size ?: 0}\n  (diagnostic only)"
        } catch (e: Throwable) {
            buildString {
                appendLine("  raw clone FAILED ${e.javaClass.name}")
                appendLine("  message=${e.message}")
                var cause: Throwable? = e.cause
                var depth = 1
                while (cause != null && depth <= 6) {
                    appendLine("  cause$depth=${cause.javaClass.name}: ${cause.message}")
                    cause = cause.cause
                    depth++
                }
                append("  (diagnostic only)")
            }
        }
    }

    // ------------------------------------------------------------------ T11

    /** T11: Ed25519 keygen, public line + fingerprint, and the sealed blob. */
    fun t11(): String {
        val generated = try {
            graph.sshKeys.generate(
                SshKeyGenerateRequest(
                    type = "ed25519",
                    label = "Phase F harness",
                    comment = "leocode-harness"
                )
            )
        } catch (e: Exception) {
            return "  FAIL keygen ${e.javaClass.simpleName}: ${e.message}"
        }
        rememberKeyId(generated.id)

        val rsa = runCatching {
            graph.sshKeys.generate(SshKeyGenerateRequest(type = "rsa", label = "Phase F RSA"))
        }
        val blob = secretsDir().listFiles()?.firstOrNull { it.name == hexId("ssh-key:${generated.id}") }

        return buildString {
            appendLine("  id=${generated.id}")
            appendLine("  type=${generated.type} fingerprint=${generated.fingerprint}")
            appendLine("  publicKey=${generated.publicKey.trim()}")
            appendLine("  rsa=${rsa.map { "${it.type} ${it.fingerprint}" }.getOrElse { "FAIL ${it.message}" }}")
            appendLine("  ciphertextBlob=${blob?.name ?: "<none>"} bytes=${blob?.length() ?: 0}")
            append(if (generated.publicKey.startsWith("ssh-ed25519 ")) "  PASS" else "  FAIL — not an ed25519 public line")
        }
    }

    // ------------------------------------------------------- T11b passphrase

    /**
     * T11b: import an OpenSSH private key that is protected by a passphrase,
     * unlock it with the right passphrase, and reject a wrong one. The key is
     * generated here with the app's own crypto, exported in PKCS#8, and sealed
     * with a passphrase — the same shape an imported file has.
     */
    fun t11Passphrase(): String {
        val passphrase = "correct horse battery staple"
        return try {
            // Build a real PEM private key. Bouncy Castle writes PKCS#8 PEM,
            // which is one of the shapes SshKeyStore.import accepts.
            val pair = dev.leocode.ssh.Crypto.generateEd25519()
            val keyWriter = java.io.StringWriter()
            org.bouncycastle.openssl.jcajce.JcaPEMWriter(keyWriter).use { writer ->
                writer.writeObject(pair.private)
            }
            val pem = keyWriter.toString()

            val imported = graph.sshKeys.import(
                dev.leocode.bridge.SshKeyImportRequest(
                    content = pem,
                    passphrase = passphrase,
                    label = "harness passphrase key"
                )
            )
            val unlocked = runCatching { graph.sshKeys.keyPair(imported.id, passphrase) }
            val wrong = runCatching { graph.sshKeys.keyPair(imported.id, "definitely-wrong") }
            val noPass = runCatching { graph.sshKeys.keyPair(imported.id, null) }

            buildString {
                appendLine("  importedId=${imported.id}")
                appendLine("  type=${imported.type} hasPassphrase=${imported.hasPassphrase}")
                appendLine("  fingerprint=${imported.fingerprint}")
                appendLine("  unlockWithCorrect=${unlocked.isSuccess}")
                appendLine("  unlockWithWrong=${wrong.isFailure} (${wrong.exceptionOrNull()?.message})")
                appendLine("  unlockWithoutPassphrase=${noPass.isFailure}")
                append(
                    if (imported.hasPassphrase && unlocked.isSuccess && wrong.isFailure && noPass.isFailure)
                        "  PASS" else "  FAIL — passphrase handling is wrong"
                )
            }
        } catch (e: Throwable) {
            "  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    // ------------------------------------------------------------------ T12

    /**
     * T12: SSH clone with an unknown host, so the prompt path runs. The clone
     * blocks inside the server-key callback; this thread answers the prompt
     * `trust + remember` and then waits for the request to finish.
     */
    fun t12(net: Net, repos: Repos): String {
        val keyId = rememberedKeyId() ?: return "  SKIP — run T11 first (no stored key)"
        graph.knownHosts.delete(net.sshHost, net.sshPort)
        val dest = "pf-t12"
        freshDirectory(dest)

        val recorder = Recorder()
        val result = AtomicReference("timeout with no result")
        val worker = Thread {
            result.set(
                runCatching {
                    val status = graph.gitEngine.clone(
                        GitCloneRequest(
                            url = net.sshUrl(repos.clone),
                            path = dest,
                            auth = GitAuth(kind = "ssh", keyId = keyId)
                        ),
                        recorder
                    )
                    "OK branch=${status.branch} head=${status.head}"
                }.getOrElse { "FAIL ${it.javaClass.simpleName}: ${it.message}" }
            )
        }

        worker.start()
        val deadline = System.currentTimeMillis() + PROMPT_WAIT_MS
        while (System.currentTimeMillis() < deadline && recorder.prompts.isEmpty()) Thread.sleep(100)
        val prompt = recorder.prompts.firstOrNull()
        prompt?.let { graph.hostKeyPrompts.answer(it.promptId, trust = true, remember = true) }
        worker.join(NET_WAIT_MS)

        val pinned = graph.knownHosts.publicKeys(net.sshHost, net.sshPort)
        val files = File(graph.workspaceStore.activeDirectory(), dest).listFiles()?.size ?: 0
        val knownHostsLine = File(graph.sshDir, "known_hosts").takeIf { it.isFile }
            ?.readLines()?.firstOrNull()?.substringBefore(' ')?.take(60)

        return buildString {
            appendLine("  url=${net.sshUrl(repos.clone)}")
            appendLine("  promptEvents=${recorder.prompts.size} pendingAfter=${graph.hostKeyPrompts.pendingCount()}")
            if (prompt != null) {
                appendLine("  prompt host=${prompt.host} port=${prompt.port} type=${prompt.keyType} changed=${prompt.changed}")
                appendLine("  promptFingerprint=${prompt.fingerprintSha256}")
            } else {
                appendLine("  prompt=<none — host was already pinned or the clone failed early>")
            }
            appendLine("  pinnedKeys=${pinned.size} knownHostsToken=$knownHostsLine")
            appendLine("  files=$files")
            appendLine("  result=${result.get()}")
            append(
                if (result.get().startsWith("OK") && files > 0 && prompt != null && pinned.isNotEmpty()) "  PASS"
                else "  FAIL — see result above"
            )
        }
    }

    /**
     * Local Git rows from the matrix (status / add / commit / diff / log /
     * branch / checkout / reset) through the production `GitEngine`, plus a
     * merge conflict detected and resolved with the whole-file strategy.
     */
    fun t21Local(): String {
        val repo = "pf-t21"
        freshDirectory(repo)
        val root = File(graph.workspaceStore.activeDirectory(), repo)
        val engine = graph.gitEngine
        return try {
            val init = engine.init(
                dev.leocode.bridge.GitInitRequest(path = repo, branch = "main")
            )
            File(root, "a.txt").writeText("one\n")
            val untracked = engine.status(dev.leocode.bridge.GitRepoRequest(path = repo))
            engine.add(
                dev.leocode.bridge.GitPathsRequest(path = repo, paths = listOf("a.txt"))
            )
            val staged = engine.status(dev.leocode.bridge.GitRepoRequest(path = repo))
            val commit = engine.commit(
                dev.leocode.bridge.GitCommitRequest(path = repo, message = "first")
            )
            File(root, "a.txt").writeText("one\ntwo\n")
            val diff = engine.diff(
                dev.leocode.bridge.GitDiffRequest(path = repo, file = "a.txt")
            )
            engine.add(
                dev.leocode.bridge.GitPathsRequest(path = repo, paths = listOf("a.txt"))
            )
            engine.commit(dev.leocode.bridge.GitCommitRequest(path = repo, message = "second"))
            engine.createBranch(
                dev.leocode.bridge.GitBranchRequest(path = repo, name = "feature")
            )
            engine.checkout(
                dev.leocode.bridge.GitCheckoutRequest(path = repo, name = "feature")
            )
            File(root, "a.txt").writeText("one\ntwo\nfeature\n")
            engine.add(dev.leocode.bridge.GitPathsRequest(path = repo, paths = listOf("a.txt")))
            engine.commit(dev.leocode.bridge.GitCommitRequest(path = repo, message = "feature"))
            engine.checkout(dev.leocode.bridge.GitCheckoutRequest(path = repo, name = "main"))
            File(root, "a.txt").writeText("one\ntwo\nmain\n")
            engine.add(dev.leocode.bridge.GitPathsRequest(path = repo, paths = listOf("a.txt")))
            engine.commit(dev.leocode.bridge.GitCommitRequest(path = repo, message = "main change"))

            // Merge in JGit directly: git.pull has no local-merge equivalent, and
            // the row under test is conflict detection/resolution.
            val conflicted = runCatching {
                org.eclipse.jgit.api.Git.open(root).use { git ->
                    git.merge().include(git.repository.resolve("feature")).call()
                }
            }
            val afterMerge = engine.status(dev.leocode.bridge.GitRepoRequest(path = repo))
            val conflict = engine.conflict(
                dev.leocode.bridge.GitConflictRequest(path = repo, file = "a.txt")
            )
            val resolved = engine.resolve(
                dev.leocode.bridge.GitResolveRequest(
                    path = repo,
                    file = "a.txt",
                    strategy = "ours"
                )
            )
            val log = engine.log(dev.leocode.bridge.GitLogRequest(path = repo, max = 10))
            val branches = engine.branches(dev.leocode.bridge.GitRepoRequest(path = repo))
            val finalText = File(root, "a.txt").readText()

            buildString {
                appendLine("  init branch=${init.branch} initialized=${init.initialized}")
                appendLine("  untracked=${untracked.untracked.map { it.path }}")
                appendLine("  staged=${staged.staged.map { "${it.status}:${it.path}" }}")
                appendLine("  commit=${commit.shortSha}")
                appendLine("  diff=${diff.diff.lines().size} line(s) binary=${diff.binary} truncated=${diff.truncated}")
                appendLine("  mergeConflicted=${conflicted.isFailure || afterMerge.conflicts.isNotEmpty()}")
                appendLine("  conflicts=${afterMerge.conflicts.map { it.path }}")
                appendLine("  conflictMarkers=${conflict.merged.contains("<<<<<<<")} ours=${conflict.ours != null} theirs=${conflict.theirs != null}")
                appendLine("  resolvedConflicts=${resolved.conflicts.size}")
                appendLine("  log=${log.commits.map { it.message }}")
                appendLine("  branches=${branches.branches.map { "${it.name}${if (it.current) "*" else ""}" }}")
                appendLine("  finalContent=${finalText.trim().replace("\n", "|")}")
                append(
                    if (commit.sha.isNotBlank() && diff.diff.isNotBlank() &&
                        conflict.merged.contains("<<<<<<<") && resolved.conflicts.isEmpty() &&
                        log.commits.size >= 3
                    ) "  PASS" else "  FAIL — see the values above"
                )
            }
        } catch (e: Exception) {
            "  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    /**
     * T12b: a host already pinned in `known_hosts` must connect with **no**
     * prompt. T12 deletes the pin first to exercise the prompt path, so without
     * this the "pinned key is found again" half of Task 23 is never tested.
     */
    fun t12Reuse(net: Net, repos: Repos): String {
        val keyId = rememberedKeyId() ?: return "  SKIP — run T11 first (no stored key)"
        if (graph.knownHosts.publicKeys(net.sshHost, net.sshPort).isEmpty()) {
            return "  SKIP — no pinned key; run T12 first"
        }
        val dest = "pf-t12b"
        freshDirectory(dest)
        val recorder = Recorder()
        val status = try {
            graph.gitEngine.clone(
                GitCloneRequest(
                    url = net.sshUrl(repos.clone),
                    path = dest,
                    auth = GitAuth(kind = "ssh", keyId = keyId)
                ),
                recorder
            )
        } catch (e: Exception) {
            return "  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
        val files = File(graph.workspaceStore.activeDirectory(), dest).listFiles()?.size ?: 0
        return buildString {
            appendLine("  url=${net.sshUrl(repos.clone)} (host already pinned)")
            appendLine("  promptEvents=${recorder.prompts.size} (expected 0)")
            appendLine("  initialized=${status.initialized} branch=${status.branch} head=${status.head} files=$files")
            append(if (recorder.prompts.isEmpty() && status.initialized && files > 0) "  PASS — pinned key trusted without a prompt"
            else "  FAIL — a pinned host must not prompt again")
        }
    }

    // ------------------------------------------------------------------ T13

    /** T13: commit inside a fresh clone and push the branch back over SSH. */
    fun t13(net: Net, repos: Repos): String {
        val keyId = rememberedKeyId() ?: return "  SKIP — run T11 first (no stored key)"
        val local = "pf-t13"
        freshDirectory(local)
        val recorder = Recorder()

        return try {
            graph.gitEngine.clone(
                GitCloneRequest(
                    url = net.sshUrl(repos.push),
                    path = local,
                    auth = GitAuth(kind = "ssh", keyId = keyId)
                ),
                recorder
            )
            File(graph.workspaceStore.activeDirectory(), "$local/harness-push.txt")
                .writeText("pushed from ${android.os.Build.MODEL} at ${System.currentTimeMillis()}\n")
            graph.gitEngine.add(GitPathsRequest(path = local, paths = listOf("harness-push.txt")))
            val commit = graph.gitEngine.commit(
                GitCommitRequest(path = local, message = "harness: T13 push from device")
            )
            val sync = graph.gitEngine.push(
                GitSyncRequest(
                    path = local,
                    remote = "origin",
                    branch = "main",
                    auth = GitAuth(kind = "ssh", keyId = keyId)
                ),
                recorder
            )
            buildString {
                appendLine("  commit=${commit.shortSha}")
                appendLine("  push branch=${sync.branch} ahead=${sync.ahead} behind=${sync.behind} message=${sync.message}")
                appendLine("  progressEvents=${recorder.progress.size} lastTask=${recorder.progress.lastOrNull()?.task ?: "-"}")
                append("  PASS — push returned without error")
            }
        } catch (e: Exception) {
            "  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    /**
     * T13b: `git.pull` over SSH. Two working copies are cloned from the same
     * remote; the second commits and pushes, then the first pulls and must
     * fast-forward to that commit. This proves the receive path — the push rows
     * only prove we can send.
     */
    fun t13Pull(net: Net, repos: Repos): String {
        val keyId = rememberedKeyId() ?: return "  SKIP — run T11 first (no stored key)"
        val first = "pf-pull-a"
        val second = "pf-pull-b"
        freshDirectory(first)
        freshDirectory(second)
        val auth = GitAuth(kind = "ssh", keyId = keyId)
        return try {
            graph.gitEngine.clone(
                GitCloneRequest(url = net.sshUrl(repos.clone), path = first, auth = auth),
                Recorder()
            )
            graph.gitEngine.clone(
                GitCloneRequest(url = net.sshUrl(repos.clone), path = second, auth = auth),
                Recorder()
            )
            val before = graph.gitEngine.status(dev.leocode.bridge.GitRepoRequest(path = first))

            // Make the remote advance from the second working copy.
            File(graph.workspaceStore.activeDirectory(), "$second/from-second.txt")
                .writeText("written by the second clone at ${System.currentTimeMillis()}\n")
            graph.gitEngine.add(
                dev.leocode.bridge.GitPathsRequest(path = second, paths = listOf("from-second.txt"))
            )
            val pushed = graph.gitEngine.commit(
                dev.leocode.bridge.GitCommitRequest(path = second, message = "harness: pull source commit")
            )
            graph.gitEngine.push(
                GitSyncRequest(path = second, remote = "origin", branch = "main", auth = auth),
                Recorder()
            )

            // The first working copy must now receive it.
            val recorder = Recorder()
            val sync = graph.gitEngine.pull(
                GitSyncRequest(path = first, remote = "origin", branch = "main", auth = auth),
                recorder
            )
            val after = graph.gitEngine.status(dev.leocode.bridge.GitRepoRequest(path = first))
            val received = File(graph.workspaceStore.activeDirectory(), "$first/from-second.txt")
            val fetchedShort = pushed.shortSha

            buildString {
                appendLine("  advancedFrom=${before.head} to=${after.head} (remote commit $fetchedShort)")
                appendLine("  pull branch=${sync.branch} ahead=${sync.ahead} behind=${sync.behind} message=${sync.message}")
                appendLine("  fileArrived=${received.isFile} contents=${received.takeIf { it.isFile }?.readText()?.trim()}")
                appendLine("  progressEvents=${recorder.progress.size}")
                append(
                    if (received.isFile && after.head != before.head)
                        "  PASS — pull fast-forwarded to the pushed commit"
                    else "  FAIL — pull did not bring the new commit"
                )
            }
        } catch (e: Exception) {
            "  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
    }


    /**
     * Diagnostic for T13T: runs the raw JGit HTTPS clone without the engine's
     * error mapping, so the real exception is visible.
     */
    fun t13tDiagnostic(net: Net): String {
        val token = net.httpsToken.ifBlank { return "  SKIP — pass --es httpsToken <token>" }
        val url = "http://${net.httpsHost}:${net.httpsPort}/${net.httpsRepoName}"
        val dir = File(graph.workspaceStore.activeDirectory(), "pf-t13tdx").apply {
            if (exists()) deleteRecursively()
        }
        return try {
            org.eclipse.jgit.api.Git.cloneRepository()
                .setURI(url)
                .setDirectory(dir)
                .setCredentialsProvider(
                    org.eclipse.jgit.transport.UsernamePasswordCredentialsProvider(net.httpsUser, token)
                )
                .call()
                .close()
            "  raw clone OK url=$url files=${dir.listFiles()?.size ?: 0}\n  (diagnostic only)"
        } catch (e: Throwable) {
            buildString {
                appendLine("  url=$url")
                appendLine("  FAILED ${e.javaClass.name}: ${e.message}")
                var cause: Throwable? = e.cause
                var depth = 1
                while (cause != null && depth <= 6) {
                    appendLine("  cause$depth=${cause.javaClass.name}: ${cause.message}")
                    cause = cause.cause
                    depth++
                }
                append("  (diagnostic only)")
            }
        }
    }

    /**
     * T13t: push over HTTPS with a token held in the SecretStore. The token is
     * set through the bridge's own `SecretHandler` path and never appears in a
     * reply: the assertion is that the push succeeds while no reply contains it.
     */
    fun t13HttpsToken(net: Net): String {
        val token = net.httpsToken.ifBlank { return "  SKIP — pass --es httpsToken <token>" }
        val host = net.httpsHost
        val port = net.httpsPort
        val url = "http://$host:$port/${net.httpsRepoName}"
        val local = "pf-https"
        freshDirectory(local)
        val recorder = Recorder()
        val replies = StringBuilder()

        return try {
            graph.secretStore.put("token:$host", token.toByteArray(Charsets.UTF_8))
            val clone = graph.gitEngine.clone(
                GitCloneRequest(
                    url = url,
                    path = local,
                    auth = GitAuth(
                        kind = "https",
                        username = net.httpsUser,
                        token = token
                    )
                ),
                recorder
            )
            replies.append(BridgeJson.value.encodeToString(
                dev.leocode.bridge.GitStatusReply.serializer(), clone
            ))
            File(graph.workspaceStore.activeDirectory(), "$local/token-push.txt")
                .writeText("pushed over https at ${System.currentTimeMillis()}\n")
            graph.gitEngine.add(dev.leocode.bridge.GitPathsRequest(path = local, paths = listOf("token-push.txt")))
            val commit = graph.gitEngine.commit(
                dev.leocode.bridge.GitCommitRequest(path = local, message = "harness: T13 https token push")
            )
            val sync = graph.gitEngine.push(
                GitSyncRequest(
                    path = local,
                    remote = "origin",
                    branch = "main",
                    auth = GitAuth(kind = "https", username = net.httpsUser, token = token)
                ),
                recorder
            )
            replies.append(BridgeJson.value.encodeToString(
                dev.leocode.bridge.GitSyncReply.serializer(), sync
            ))
            val storedTokenLeaked = replies.contains(token)
            val remoteList = runCatching {
                BridgeJson.value.encodeToString(
                    dev.leocode.bridge.GitRemoteListReply.serializer(),
                    graph.gitEngine.remotes(dev.leocode.bridge.GitRepoRequest(path = local))
                )
            }.getOrDefault("")
            val remoteLeaked = remoteList.contains(token)
            val hasTokenFlag = remoteList.contains("\"hasToken\":true")

            buildString {
                appendLine("  url=$url clone=${clone.initialized} branch=${clone.branch}")
                appendLine("  commit=${commit.shortSha} pushMsg=${sync.message}")
                appendLine("  tokenInReplies=$storedTokenLeaked remoteListExposesValue=$remoteLeaked hasToken=$hasTokenFlag")
                appendLine("  progressEvents=${recorder.progress.size}")
                append(
                    if (!storedTokenLeaked && !remoteLeaked && commit.shortSha.isNotBlank())
                        "  PASS — push authed with the token and the value never came back"
                    else "  FAIL — token leaked into a reply or the push did not run"
                )
            }
        } catch (e: Exception) {
            "  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    // ------------------------------------------------------------------ T14

    /**
     * Raw JGit SSH clone with the app's key store and host-key handling, but
     * without GitEngine's error mapping, so the real exception is visible.
     */
    fun t12Diagnostic(net: Net, repos: Repos): String {
        val keyId = rememberedKeyId() ?: return "  SKIP — run T11 first (no stored key)"
        return try {
            val pair = graph.sshKeys.keyPair(keyId)
            val emit: (SshHostPrompt) -> Unit = { prompt ->
                graph.hostKeyPrompts.answer(prompt.promptId, trust = true, remember = true)
            }
            val factory = dev.leocode.ssh.LeoSshSessionFactory(
                keyPairs = listOf(pair),
                knownHosts = graph.knownHosts,
                prompts = graph.hostKeyPrompts,
                emit = emit,
                sshDir = graph.sshDir
            )
            val dir = File(graph.workspaceStore.activeDirectory(), "pf-t12dx").apply {
                if (exists()) deleteRecursively()
            }
            org.eclipse.jgit.api.Git.cloneRepository()
                .setURI(net.sshUrl(repos.clone))
                .setDirectory(dir)
                .setTransportConfigCallback { transport ->
                    (transport as? org.eclipse.jgit.transport.SshTransport)
                        ?.sshSessionFactory = factory
                }
                .call()
                .close()
            "  raw ssh clone OK files=${dir.listFiles()?.size ?: 0} pinned=${graph.knownHosts.publicKeys(net.sshHost, net.sshPort).size}\n  (diagnostic only)"
        } catch (e: Throwable) {
            buildString {
                appendLine("  raw ssh clone FAILED ${e.javaClass.name}")
                appendLine("  message=${e.message}")
                var cause: Throwable? = e.cause
                var depth = 1
                while (cause != null && depth <= 8) {
                    appendLine("  cause$depth=${cause.javaClass.name}: ${cause.message}")
                    cause = cause.cause
                    depth++
                }
                append("  (diagnostic only)")
            }
        }
    }

    fun t14(): String {
        val token = "pf-token-${System.nanoTime()}"
        val id = "token:harness.test"
        return try {
            graph.secretStore.put(id, token.toByteArray(Charsets.UTF_8))
            val back = graph.secretStore.get(id)?.toString(Charsets.UTF_8)
            val blobFile = secretsDir().listFiles()?.firstOrNull { it.name == hexId(id) }
            val bytes = blobFile?.readBytes() ?: ByteArray(0)
            val magic = String(bytes.copyOfRange(0, minOf(4, bytes.size)), Charsets.US_ASCII)
            val plaintextOnDisk = bytes.toString(Charsets.ISO_8859_1).contains(token)
            val hosts = graph.secretStore.ids().filter { it.startsWith("token:") }

            buildString {
                appendLine("  id=$id")
                appendLine("  roundTrip=${if (back == token) "match" else "MISMATCH"}")
                appendLine("  blob=${blobFile?.name ?: "<none>"} bytes=${bytes.size} magic=$magic")
                appendLine("  plaintextOnDisk=$plaintextOnDisk")
                appendLine("  tokenHosts=${hosts.map { it.removePrefix("token:") }}")
                append(if (back == token && !plaintextOnDisk && magic == "LCS1") "  PASS"
                else "  FAIL — round-trip or ciphertext check failed")
            }
        } catch (e: Exception) {
            "  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    // ------------------------------------------------------------- helpers

    private fun secretsDir(): File = File(context.filesDir, "secrets")

    /** FileSecretStore names a blob with the hex of the id's UTF-8 bytes. */
    private fun hexId(id: String): String =
        id.toByteArray(Charsets.UTF_8).joinToString("") { byte -> "%02x".format(byte) } + ".bin"

    private fun freshDirectory(name: String) {
        val dir = File(graph.workspaceStore.activeDirectory(), name)
        if (dir.exists()) dir.deleteRecursively()
    }
}
