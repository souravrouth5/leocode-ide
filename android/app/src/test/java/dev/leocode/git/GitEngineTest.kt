package dev.leocode.git

import dev.leocode.bridge.GitCloneRequest
import dev.leocode.bridge.GitCommitRequest
import dev.leocode.bridge.GitDiffRequest
import dev.leocode.bridge.GitInitRequest
import dev.leocode.bridge.GitLogRequest
import dev.leocode.bridge.GitPathsRequest
import dev.leocode.bridge.GitRepoRequest
import dev.leocode.bridge.GitSyncRequest
import dev.leocode.bridge.NoopStreamSink
import dev.leocode.ssh.TestSecrets
import java.io.File
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.lib.PersonIdent
import org.eclipse.jgit.transport.RefSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Task 21: local Git behaviour on a real repository, without Android.
 *
 * Everything goes through [GitEngine] the way the bridge does; only the secret
 * store uses the JVM test cipher.
 */
class GitEngineTest {

    @Test
    fun `init add commit status log and diff`() {
        val engine = engine()
        val status = engine.init(GitInitRequest())

        assertTrue(status.initialized)
        assertEquals("main", status.branch)
        assertTrue(status.clean)

        File(workspace, "hello.txt").writeText("one\n")
        val pending = engine.status(GitRepoRequest())
        assertFalse(pending.clean)
        assertEquals(listOf("hello.txt"), pending.untracked.map { it.path })

        val staged = engine.add(GitPathsRequest(paths = listOf("hello.txt")))
        assertEquals(listOf("hello.txt"), staged.staged.map { it.path })
        assertTrue(staged.untracked.isEmpty())

        val commit = engine.commit(
            GitCommitRequest(message = "first", authorName = "Test", authorEmail = "t@example.com")
        )
        assertEquals(40, commit.sha.length)
        assertEquals(7, commit.shortSha.length)

        val clean = engine.status(GitRepoRequest())
        assertTrue(clean.clean)
        assertEquals(commit.shortSha, clean.head)

        val log = engine.log(GitLogRequest())
        assertEquals(1, log.commits.size)
        assertEquals("first", log.commits.single().message)
        assertEquals("t@example.com", log.commits.single().email)

        File(workspace, "hello.txt").writeText("one\ntwo\n")
        val diff = engine.diff(GitDiffRequest(file = "hello.txt"))
        assertFalse(diff.binary)
        assertTrue(diff.diff.contains("+two"))

        // Unstage without touching the working tree.
        val reset = engine.reset(GitPathsRequest(paths = listOf("hello.txt")))
        assertTrue(reset.staged.isEmpty())
        assertTrue(File(workspace, "hello.txt").readText().contains("two"))
    }

    @Test
    fun `branches create list checkout and delete`() {
        val engine = engine()
        engine.init(GitInitRequest())
        File(workspace, "a.txt").writeText("a\n")
        engine.add(GitPathsRequest(paths = listOf("a.txt")))
        engine.commit(GitCommitRequest(message = "base"))

        val created = engine.createBranch(
            dev.leocode.bridge.GitBranchRequest(name = "feature")
        )
        assertTrue(created.staged.isEmpty())
        val list = engine.branches(GitRepoRequest())
        assertEquals("main", list.current)
        assertTrue(list.branches.any { it.name == "feature" && !it.current })

        val checkout = engine.checkout(
            dev.leocode.bridge.GitCheckoutRequest(name = "feature")
        )
        assertEquals("feature", checkout.branch)

        engine.checkout(dev.leocode.bridge.GitCheckoutRequest(name = "main"))
        val deleted = engine.deleteBranch(
            dev.leocode.bridge.GitBranchRequest(name = "feature")
        )
        assertEquals("main", deleted.branch)
        assertFalse(engine.branches(GitRepoRequest()).branches.any { it.name == "feature" })
    }

    @Test
    fun `clone fetch pull and push use the local transport`() {
        val origin = seedOrigin()
        val engine = engine()
        val cloned = engine.clone(
            GitCloneRequest(url = origin.toURI().toString(), path = "cloned"),
            NoopStreamSink
        )
        assertTrue(cloned.initialized)
        assertEquals("main", cloned.branch)
        assertTrue(File(workspace, "cloned/hello.txt").isFile)

        // A new upstream commit becomes visible after fetch and pull.
        commitTo(origin, "hello.txt", "one\ntwo\n", "second")
        engine.fetch(
            GitSyncRequest(path = "cloned", remote = "origin"),
            NoopStreamSink
        )
        val afterFetch = engine.status(GitRepoRequest(path = "cloned"))
        assertEquals(1, afterFetch.behind)

        engine.pull(
            GitSyncRequest(path = "cloned", remote = "origin"),
            NoopStreamSink
        )
        assertEquals("one\ntwo\n", File(workspace, "cloned/hello.txt").readText())

        // A clone commit is pushed back to the bare origin.
        File(workspace, "cloned/local.txt").writeText("local\n")
        engine.add(GitPathsRequest(path = "cloned", paths = listOf("local.txt")))
        engine.commit(
            GitCommitRequest(
                path = "cloned",
                message = "from clone",
                authorName = "Test",
                authorEmail = "t@example.com"
            )
        )
        val pushed = engine.push(
            GitSyncRequest(path = "cloned", remote = "origin"),
            NoopStreamSink
        )
        assertEquals("main", pushed.branch)
        Git.open(origin).use { bare ->
            assertNotNull(bare.repository.resolve("refs/heads/main"))
            val tree = bare.repository.parseCommit(bare.repository.resolve("refs/heads/main"))
            assertNotNull(tree)
        }
    }

    @Test
    fun `uninitialized directory is not an error`() {
        val status = engine().status(GitRepoRequest())

        assertFalse(status.initialized)
        assertTrue(status.clean)
    }

    @Test
    fun `paths outside the workspace are rejected`() {
        val engine = engine()
        engine.init(GitInitRequest())
        try {
            engine.status(GitRepoRequest(path = "../outside"))
            throw AssertionError("expected E_PATH_OUTSIDE_ROOT")
        } catch (e: dev.leocode.bridge.BridgeException) {
            assertEquals(dev.leocode.bridge.ErrorCode.E_PATH_OUTSIDE_ROOT, e.errorCode)
        }
    }

    @Test
    fun `cancel for an unknown operation is a no-op`() {
        assertFalse(engine().cancel("not-running"))
        assertFalse(engine().cancel(null))
    }

    @Test
    fun `conflict markers are split into ours and theirs`() {
        val engine = engine()
        engine.init(GitInitRequest())
        val conflicting = """
            before
            <<<<<<< HEAD
            ours line
            =======
            theirs line
            >>>>>>> feature
            after
        """.trimIndent() + "\n"
        File(workspace, "conflict.txt").writeText(conflicting)

        val reply = engine.conflict(
            dev.leocode.bridge.GitConflictRequest(file = "conflict.txt")
        )

        assertTrue(reply.merged.contains("<<<<<<<"))
        assertTrue(reply.ours!!.contains("ours line"))
        assertTrue(reply.ours!!.contains("before"))
        assertFalse(reply.ours!!.contains("theirs line"))
        assertTrue(reply.theirs!!.contains("theirs line"))
        assertFalse(reply.binary)
    }

    private val workspace: File by lazy {
        java.nio.file.Files.createTempDirectory("git-engine").toFile().also { it.deleteOnExit() }
    }

    private fun engine(): GitEngine {
        val dir = File(workspace, "state")
        return GitEngine(
            workspaceRoot = { workspace },
            secrets = TestSecrets.store(dir),
            keyStore = dev.leocode.ssh.SshKeyStore(
                File(dir, "ssh"),
                TestSecrets.store(dir),
                dev.leocode.bridge.BridgeJson.value
            ),
            knownHosts = dev.leocode.ssh.KnownHostsStore(File(dir, "ssh/known_hosts")),
            prompts = dev.leocode.ssh.HostKeyPrompts(
                dev.leocode.ssh.KnownHostsStore(File(dir, "ssh/known_hosts"))
            ),
            json = dev.leocode.bridge.BridgeJson.value
        )
    }

    private fun seedOrigin(): File {
        val origin = File(workspace.parentFile, "${workspace.name}-origin.git")
        origin.deleteRecursively()
        Git.init().setBare(true).setDirectory(origin).call().close()
        val seed = Git.init().setDirectory(File(workspace, "seed")).setInitialBranch("main").call()
        try {
            File(workspace, "seed/hello.txt").writeText("one\n")
            seed.add().addFilepattern("hello.txt").call()
            seed.commit()
                .setMessage("initial")
                .setAuthor(PersonIdent("Test", "t@example.com"))
                .setCommitter(PersonIdent("Test", "t@example.com"))
                .call()
            val branch = seed.repository.branch
            seed.push()
                .setRemote(origin.toURI().toString())
                .setRefSpecs(RefSpec("refs/heads/$branch:refs/heads/$branch"))
                .call()
            Git.open(origin).use { bare ->
                bare.repository.updateRef("HEAD").link("refs/heads/$branch")
            }
        } finally {
            seed.close()
        }
        return origin
    }

    private fun commitTo(origin: File, path: String, content: String, message: String) {
        val seed = Git.open(File(workspace, "seed"))
        try {
            File(workspace, "seed/$path").writeText(content)
            seed.add().addFilepattern(path).call()
            seed.commit()
                .setMessage(message)
                .setAuthor(PersonIdent("Test", "t@example.com"))
                .setCommitter(PersonIdent("Test", "t@example.com"))
                .call()
            seed.push().setRemote(origin.toURI().toString()).call()
        } finally {
            seed.close()
        }
    }
}
