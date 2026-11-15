package dev.leocode.ssh

import dev.leocode.bridge.SshHostPrompt
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Task 23: unknown hosts prompt, changed keys fail, answers unblock the Git request. */
class HostKeyPromptsTest {

    @Test
    fun `an unknown host prompts and a trusted answer pins the key`() {
        val known = store()
        val prompts = HostKeyPrompts(known, timeoutMs = 5_000)
        val key = Crypto.generateEd25519().public
        val prompt = AtomicReference<SshHostPrompt?>()
        val emitted = CountDownLatch(1)
        val result = AtomicReference<HostKeyPrompts.Result?>()

        val worker = Thread {
            result.set(prompts.verify("example.com", 22, key) { event ->
                prompt.set(event)
                emitted.countDown()
            })
        }
        worker.start()

        assertTrue(emitted.await(2, TimeUnit.SECONDS))
        val event = prompt.get()!!
        assertEquals("example.com", event.host)
        assertEquals(22, event.port)
        assertEquals("ssh-ed25519", event.keyType)
        assertTrue(event.fingerprintSha256.startsWith("SHA256:"))
        assertFalse(event.changed)
        assertFalse(known.has("example.com", 22))

        assertTrue(prompts.answer(event.promptId, trust = true, remember = true))
        worker.join(2_000)

        assertEquals(HostKeyPrompts.Result.TRUSTED, result.get())
        assertTrue(known.has("example.com", 22))
    }

    @Test
    fun `reject fails the connection and stores nothing`() {
        val known = store()
        val prompts = HostKeyPrompts(known, timeoutMs = 5_000)
        val prompt = AtomicReference<SshHostPrompt?>()
        val emitted = CountDownLatch(1)
        val result = AtomicReference<HostKeyPrompts.Result?>()

        val worker = Thread {
            result.set(prompts.verify("example.com", 22, Crypto.generateEd25519().public) { event ->
                prompt.set(event)
                emitted.countDown()
            })
        }
        worker.start()
        assertTrue(emitted.await(2, TimeUnit.SECONDS))

        assertTrue(prompts.answer(prompt.get()!!.promptId, trust = false, remember = true))
        worker.join(2_000)

        assertEquals(HostKeyPrompts.Result.REJECTED, result.get())
        assertFalse(known.has("example.com", 22))
    }

    @Test
    fun `a changed key fails immediately without a prompt`() {
        val known = store()
        known.add("example.com", 22, Crypto.generateEd25519().public)
        val prompts = HostKeyPrompts(known, timeoutMs = 5_000)
        val promptsEmitted = AtomicInteger(0)

        val result = prompts.verify("example.com", 22, Crypto.generateEd25519().public) {
            promptsEmitted.incrementAndGet()
        }

        assertEquals(HostKeyPrompts.Result.CHANGED, result)
        assertEquals(0, promptsEmitted.get())
        assertEquals(1, known.entries().size)
    }

    @Test
    fun `a matching key is trusted silently`() {
        val known = store()
        val key = Crypto.generateEd25519().public
        known.add("example.com", 22, key)
        val prompts = HostKeyPrompts(known)

        val result = prompts.verify("example.com", 22, key) {
            throw AssertionError("must not prompt for a known key")
        }

        assertEquals(HostKeyPrompts.Result.TRUSTED, result)
    }

    @Test
    fun `an unanswered prompt times out as rejected`() {
        val known = store()
        val prompts = HostKeyPrompts(known, timeoutMs = 100)
        val start = System.nanoTime()

        val result = prompts.verify("example.com", 22, Crypto.generateEd25519().public) {}

        val elapsedMs = (System.nanoTime() - start) / 1_000_000
        assertEquals(HostKeyPrompts.Result.REJECTED, result)
        assertTrue("waited $elapsedMs ms", elapsedMs >= 90)
        assertEquals(0, prompts.pendingCount())
        assertFalse(known.has("example.com", 22))
    }

    @Test
    fun `answer for an expired prompt returns false`() {
        assertEquals(false, HostKeyPrompts(store()).answer("missing", true, true))
    }

    private fun store(): KnownHostsStore {
        val root = java.nio.file.Files.createTempDirectory("host-prompts").toFile()
        root.deleteOnExit()
        return KnownHostsStore(File(root, "ssh/known_hosts"))
    }
}
