package dev.leocode.ssh

import dev.leocode.bridge.SshHostPrompt
import java.security.PublicKey
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.apache.sshd.common.config.keys.KeyUtils

/**
 * Host-key trust decisions for SSH remotes (Task 23).
 *
 * A key that matches `known_hosts` is accepted silently. An unknown host emits
 * one `ssh.hostkey.prompt` through the Git request's sink and blocks that Git
 * request for up to [timeoutMs] while the user decides; `ssh.hostkey.answer`
 * completes the wait. A host whose pinned key no longer matches is *changed*:
 * the verification fails immediately with [Result.CHANGED] and never prompts,
 * because prompting would train the user to tap Trust on a possible MITM.
 *
 * "Forget host" (`ssh.hostkey.delete`) is the only way to pin a new key for a
 * changed host. Answers that arrive after the wait ended are ignored.
 */
class HostKeyPrompts(
    private val knownHosts: KnownHostsStore,
    private val timeoutMs: Long = 120_000L
) {

    enum class Result { TRUSTED, REJECTED, CHANGED }

    private data class Answer(val trust: Boolean, val remember: Boolean)

    private data class Pending(
        val host: String,
        val port: Int,
        val key: PublicKey,
        val future: CompletableFuture<Answer>
    )

    private val pending = ConcurrentHashMap<String, Pending>()

    /** Number of prompts currently blocking a Git request; used by tests and shutdown. */
    fun pendingCount(): Int = pending.size

    /**
     * Verifies [key] for [host]:[port], emitting one prompt when the host is unknown.
     * Returns [Result.CHANGED] without prompting when a different key is pinned.
     */
    fun verify(
        host: String,
        port: Int,
        key: PublicKey,
        emit: (SshHostPrompt) -> Unit
    ): Result {
        val existing = knownHosts.publicKeys(host, port)
        if (existing.any { KeyUtils.compareKeys(it, key) }) return Result.TRUSTED
        if (existing.isNotEmpty()) return Result.CHANGED

        val promptId = UUID.randomUUID().toString()
        val future = CompletableFuture<Answer>()
        val prompt = Pending(host, port, key, future)
        pending[promptId] = prompt
        val event = SshHostPrompt(
            promptId = promptId,
            host = host,
            port = port,
            keyType = KeyUtils.getKeyType(key) ?: "unknown",
            fingerprintSha256 = KeyUtils.getFingerPrint(key),
            changed = false,
            previousFingerprint = null
        )
        try {
            emit(event)
            val answer = try {
                future.get(timeoutMs, TimeUnit.MILLISECONDS)
            } catch (_: TimeoutException) {
                Answer(trust = false, remember = false)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                Answer(trust = false, remember = false)
            }
            if (!answer.trust) return Result.REJECTED
            if (answer.remember) knownHosts.add(host, port, key)
            return Result.TRUSTED
        } finally {
            pending.remove(promptId)
        }
    }

    /** Completes a prompt from `ssh.hostkey.answer`; false when it already expired. */
    fun answer(promptId: String, trust: Boolean, remember: Boolean): Boolean {
        val prompt = pending[promptId] ?: return false
        return prompt.future.complete(Answer(trust, remember))
    }

    /** Fails every pending prompt, used when the bridge goes away. */
    fun cancelAll() {
        for (id in pending.keys) {
            pending[id]?.future?.complete(Answer(trust = false, remember = false))
        }
    }
}
