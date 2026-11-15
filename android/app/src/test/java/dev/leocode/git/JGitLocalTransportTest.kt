package dev.leocode.git

import java.io.File
import org.eclipse.jgit.api.Git
import org.eclipse.jgit.api.ResetCommand
import org.eclipse.jgit.lib.PersonIdent
import org.eclipse.jgit.transport.RefSpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * D-016 validation for the JGit 5.13 dependency change.
 *
 * The Git engine only needs JGit's local transport for the Task 21 tests and for
 * clone/push in the later Git work. This proves the pinned 5.13.3 artifact can
 * initialise a bare repository, clone it over `file://`, fetch new commits and
 * push them back on a plain JVM (no Android classes, no network).
 */
class JGitLocalTransportTest {

    @Test
    fun `local clone fetch and push work with the pinned JGit`() {
        val root = createTempDir("jgit-local-transport")
        val originDir = File(root, "origin.git")
        val seedDir = File(root, "seed")
        val cloneDir = File(root, "clone")

        Git.init().setBare(true).setDirectory(originDir).call().use { }
        val seed = Git.init().setDirectory(seedDir).call()
        try {
            val branch = seed.repository.branch
            File(seedDir, "hello.txt").writeText("one\n")
            seed.add().addFilepattern("hello.txt").call()
            seed.commit()
                .setMessage("first")
                .setAuthor(ident())
                .setCommitter(ident())
                .call()
            seed.push()
                .setRemote(originDir.toURI().toString())
                .setRefSpecs(RefSpec("refs/heads/$branch:refs/heads/$branch"))
                .call()

            val clone = Git.cloneRepository()
                .setURI(originDir.toURI().toString())
                .setDirectory(cloneDir)
                .setBranch(branch)
                .call()
            try {
                assertEquals("one\n", File(cloneDir, "hello.txt").readText())

                // A new upstream commit is visible after fetch.
                File(seedDir, "hello.txt").writeText("one\ntwo\n")
                seed.add().addFilepattern("hello.txt").call()
                seed.commit()
                    .setMessage("second")
                    .setAuthor(ident())
                    .setCommitter(ident())
                    .call()
                val upstream = seed.repository.resolve("refs/heads/$branch")
                seed.push()
                    .setRemote(originDir.toURI().toString())
                    .setRefSpecs(RefSpec("refs/heads/$branch:refs/heads/$branch"))
                    .call()

                clone.fetch().setRemote("origin").call()
                assertEquals(
                    upstream,
                    clone.repository.resolve("refs/remotes/origin/$branch")
                )

                // Move the clone onto the fetched upstream tip so the next push
                // is a fast-forward; a stale branch would be rejected.
                clone.reset().setMode(ResetCommand.ResetType.HARD)
                    .setRef("origin/$branch").call()

                // A clone commit pushes back to the bare origin.
                File(cloneDir, "from-clone.txt").writeText("clone\n")
                clone.add().addFilepattern("from-clone.txt").call()
                clone.commit()
                    .setMessage("from clone")
                    .setAuthor(ident())
                    .setCommitter(ident())
                    .call()
                val local = clone.repository.resolve("refs/heads/$branch")
                clone.push().setRemote("origin").call()

                Git.open(originDir).use { bare ->
                    assertEquals(local, bare.repository.resolve("refs/heads/$branch"))
                }
                assertTrue(File(originDir, "objects").isDirectory)
            } finally {
                clone.close()
            }
        } finally {
            seed.close()
        }
    }

    private fun ident(): PersonIdent =
        PersonIdent("LeoCode Test", "test@leocode.dev")
}
