package dev.leocode.ssh

import dev.leocode.bridge.SshHostPrompt
import java.io.File
import java.net.InetSocketAddress
import java.nio.file.Path
import java.security.KeyPair
import java.security.PublicKey
import org.eclipse.jgit.transport.sshd.ServerKeyDatabase
import org.eclipse.jgit.transport.sshd.SshdSessionFactory

/**
 * JGit transport factory for app-owned SSH identities (Task 23).
 *
 * JGit asks this factory for the identity list and for the server-key policy on
 * every connection. The identity comes from [SshKeyStore] (already decoded by the
 * caller), known hosts come from [KnownHostsStore], and unknown hosts go through
 * [HostKeyPrompts] on the Git request's event sink.
 *
 * [lastDenied] records why the most recent `accept` returned false so the Git
 * engine can turn a JGit "server key rejected" into `E_HOSTKEY_CHANGED` instead
 * of a generic auth failure. One factory instance serves exactly one Git network
 * operation, so the field cannot race with another operation.
 */
class LeoSshSessionFactory(
    private val keyPairs: List<KeyPair>,
    private val knownHosts: KnownHostsStore,
    private val prompts: HostKeyPrompts,
    private val emit: (SshHostPrompt) -> Unit,
    sshDir: File
) : SshdSessionFactory() {

    init {
        // Keep JGit away from ~/.ssh: the app has no home directory and must
        // never read a desktop user's keys or known_hosts.
        setHomeDirectory(sshDir)
        setSshDirectory(sshDir)
    }

    @Volatile
    var lastDenied: HostKeyPrompts.Result? = null
        private set

    override fun getDefaultKeys(home: File): Iterable<KeyPair> = keyPairs

    override fun getDefaultIdentities(home: File): List<Path> = emptyList()

    override fun getDefaultPreferredAuthentications(): String = "publickey"

    override fun getServerKeyDatabase(home: File, sshDir: File): ServerKeyDatabase =
        object : ServerKeyDatabase {
            override fun lookup(
                host: String,
                address: InetSocketAddress,
                config: ServerKeyDatabase.Configuration
            ): List<PublicKey> = knownHosts.publicKeys(normalizeHost(host), address.port)

            override fun accept(
                host: String,
                address: InetSocketAddress,
                key: PublicKey,
                config: ServerKeyDatabase.Configuration,
                credentialsProvider: org.eclipse.jgit.transport.CredentialsProvider?
            ): Boolean {
                val result = prompts.verify(normalizeHost(host), address.port, key, emit)
                lastDenied = if (result == HostKeyPrompts.Result.TRUSTED) null else result
                return result == HostKeyPrompts.Result.TRUSTED
            }
        }

    companion object {
        /**
         * JGit passes the connect address as `[host]:port` (or `[host]`), but
         * `known_hosts` and the prompts are keyed by the bare host name. Without
         * this, a non-default port was stored as `[[10.0.0.5]:2222]:2222` — not
         * valid OpenSSH — and the pinned key could never be found again, so the
         * host was re-prompted on every connection.
         *
         * An IPv6 literal keeps its inner colons, so only the brackets and the
         * trailing `:port` are removed.
         */
        fun normalizeHost(raw: String): String {
            val host = raw.trim()
            if (host.startsWith("[")) {
                val close = host.indexOf(']')
                if (close > 0) return host.substring(1, close)
            }
            val colon = host.lastIndexOf(':')
            val singleColon = colon > 0 && host.indexOf(':') == colon
            if (singleColon && host.substring(colon + 1).all { it.isDigit() }) {
                return host.substring(0, colon)
            }
            return host
        }
    }
}
