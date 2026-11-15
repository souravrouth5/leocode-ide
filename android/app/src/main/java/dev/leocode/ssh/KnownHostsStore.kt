package dev.leocode.ssh

import dev.leocode.core.AtomicWriter
import java.io.File
import java.io.IOException
import java.security.PublicKey
import org.apache.sshd.common.config.keys.KeyUtils
import org.apache.sshd.common.config.keys.PublicKeyEntry

/**
 * OpenSSH-compatible `known_hosts` file (Task 23).
 *
 * The file lives at `filesDir/ssh/known_hosts` and uses the standard line format
 * (`host keytype base64 [comment]`), so it can be inspected or copied to a
 * desktop client. Non-default ports are written as `[host]:port`, exactly like
 * OpenSSH. The optional trailing comment carries `leocode-added=<epoch>` for the
 * UI's "added" column; OpenSSH ignores it.
 *
 * Writes are atomic and deduplicated by host/port: trusting a new key for a host
 * replaces the old line, so the file never grows a second key that would make a
 * later connection look "changed" for the wrong reason.
 */
class KnownHostsStore(private val file: File) {

    companion object {
        private const val ADDED_PREFIX = "leocode-added="
        private const val DEFAULT_PORT = 22
    }

    private val lock = Any()

    /** True when at least one key is pinned for [host]:[port]. */
    fun has(host: String, port: Int): Boolean =
        synchronized(lock) { readLines().any { it.host == host && it.port == port } }

    /** Pinned public keys for [host]:[port]; empty when the host is unknown. */
    fun publicKeys(host: String, port: Int): List<PublicKey> = synchronized(lock) {
        readLines()
            .filter { it.host == host && it.port == port }
            .mapNotNull { runCatching { it.publicKey() }.getOrNull() }
    }

    /** True when a different key is already pinned for [host]:[port]. */
    fun differs(host: String, port: Int, offered: PublicKey): Boolean {
        val existing = publicKeys(host, port)
        return existing.isNotEmpty() && existing.none { KeyUtils.compareKeys(it, offered) }
    }

    /** Pins [key], replacing any previous key for the same host and port. */
    fun add(host: String, port: Int, key: PublicKey, addedAt: Long = System.currentTimeMillis()) {
        val line = "${tokenFor(host, port)} ${Crypto.encodePublic(key)} $ADDED_PREFIX$addedAt"
        synchronized(lock) {
            val kept = readLines()
                .filterNot { it.host == host && it.port == port }
                .map { it.raw }
            writeAll(kept + line)
        }
    }

    fun delete(host: String, port: Int): Boolean = synchronized(lock) {
        val entries = readLines()
        val kept = entries.filterNot { it.host == host && it.port == port }
        if (kept.size == entries.size) return false
        writeAll(kept.map { it.raw })
        true
    }

    /** All pinned hosts, sorted for a stable reply. */
    fun entries(): List<Entry> = synchronized(lock) {
        readLines().sortedWith(compareBy({ it.host }, { it.port }, { it.keyType }))
    }

    data class Entry(
        val host: String,
        val port: Int,
        val keyType: String,
        val base64: String,
        val addedAt: Long,
        val raw: String
    ) {
        fun publicKey(): PublicKey =
            PublicKeyEntry.parsePublicKeyEntry("$keyType $base64")
                .resolvePublicKey(
                    null,
                    emptyMap(),
                    org.apache.sshd.common.config.keys.PublicKeyEntryResolver.IGNORING
                ) ?: throw IOException("unsupported key type: $keyType")

        fun fingerprint(): String = KeyUtils.getFingerPrint(publicKey())
    }

    private fun tokenFor(host: String, port: Int): String =
        if (port == DEFAULT_PORT) host else "[$host]:$port"

    private fun readLines(): List<Entry> {
        if (!file.isFile) return emptyList()
        val text = try {
            file.readText()
        } catch (_: IOException) {
            return emptyList()
        }
        val entries = ArrayList<Entry>()
        for (raw in text.lineSequence()) {
            val line = raw.trim()
            if (line.isEmpty() || line.startsWith("#")) continue
            val parts = line.split(Regex("\\s+"))
            if (parts.size < 3) continue
            // Hashed host names (|1|salt|hash) cannot be matched without the hash.
            if (parts[0].startsWith("|")) continue
            val (host, port) = parseToken(parts[0]) ?: continue
            val addedAt = parts.drop(3)
                .firstOrNull { it.startsWith(ADDED_PREFIX) }
                ?.removePrefix(ADDED_PREFIX)
                ?.toLongOrNull() ?: 0L
            entries += Entry(host, port, parts[1], parts[2], addedAt, line)
        }
        return entries
    }

    private fun writeAll(lines: List<String>) {
        val parent = file.parentFile ?: throw IOException("known_hosts has no directory")
        if (!parent.isDirectory && !parent.mkdirs() && !parent.isDirectory) {
            throw IOException("cannot create the ssh directory")
        }
        val body = buildString {
            for (line in lines) {
                append(line)
                append('\n')
            }
        }
        AtomicWriter.write(file, body.toByteArray())
        runCatching {
            file.setReadable(false, false)
            file.setReadable(true, true)
            file.setWritable(false, false)
            file.setWritable(true, true)
        }
    }

    private fun parseToken(token: String): Pair<String, Int>? {
        if (token.startsWith("[")) {
            val close = token.lastIndexOf("]:")
            if (close <= 1) return null
            val host = token.substring(1, close)
            val port = token.substring(close + 2).toIntOrNull() ?: return null
            return host to port
        }
        // A comma-separated list is legal in OpenSSH; keep the first name.
        val first = token.substringBefore(',')
        if (first.isBlank()) return null
        return first to DEFAULT_PORT
    }
}
