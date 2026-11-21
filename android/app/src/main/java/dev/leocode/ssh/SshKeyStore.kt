package dev.leocode.ssh

import dev.leocode.bridge.SshKeyGenerateRequest
import dev.leocode.bridge.SshKeyImportRequest
import dev.leocode.bridge.SshKeyInfo
import dev.leocode.core.AtomicWriter
import dev.leocode.core.secrets.FileSecretStore
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.security.KeyPair
import java.util.UUID
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * SSH identities owned by the app (Task 23).
 *
 * Public data lives in `filesDir/ssh/keys.json`; the PKCS#8 private key only
 * exists as a Keystore-sealed secret under `ssh-key:<id>`. A passphrase adds a
 * second AES-GCM layer inside that secret, but the file is always encrypted by
 * the Keystore, so a lost passphrase is recoverable only by deleting the key.
 *
 * Import accepts OpenSSH, PEM (`RSA PRIVATE KEY`) and PKCS#8 through MINA's key
 * parsers, including bcrypt-protected OpenSSH files. Nothing private is ever
 * logged or returned in [SshKeyInfo].
 */
class SshKeyStore(
    private val dir: File,
    private val secrets: FileSecretStore,
    private val json: Json
) {

    companion object {
        private const val SECRET_PREFIX = "ssh-key:"
        private const val METADATA = "keys.json"
        private const val DEFAULT_COMMENT = "leocode@android"
        private const val DEFAULT_RSA_BITS = 3072
        private val RSA_BITS = setOf(2048, 3072, 4096)
    }

    @Serializable
    data class StoredKey(
        val id: String,
        val label: String,
        val type: String,
        val fingerprint: String,
        val comment: String = "",
        val hasPassphrase: Boolean = false,
        val createdAt: Long = 0,
        val publicKey: String = ""
    )

    @Serializable
    private data class KeyFile(val keys: List<StoredKey> = emptyList())

    private val lock = Any()
    private val metadataFile = File(dir, METADATA)

    init {
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
            throw IOException("cannot create the ssh directory")
        }
    }

    fun list(): List<SshKeyInfo> = read().map { it.toInfo() }

    /** Directory holding `keys.json`; used for the SSH known_hosts/identity layout. */
    fun directory(): File = dir

    fun info(id: String): SshKeyInfo? = read().firstOrNull { it.id == id }?.toInfo()

    fun generate(request: SshKeyGenerateRequest): SshKeyInfo {
        val type = (request.type ?: "ed25519").lowercase()
        val comment = request.comment?.trim().orEmpty().ifEmpty { DEFAULT_COMMENT }
        val passphrase = request.passphrase
        val pair: KeyPair = when (type) {
            "ed25519" -> Crypto.generateEd25519()
            "rsa" -> {
                val bits = if (request.bits == 0) DEFAULT_RSA_BITS else request.bits
                if (bits !in RSA_BITS) {
                    throw IOException("RSA keys use 2048, 3072 or 4096 bits")
                }
                Crypto.generateRsa(bits)
            }
            else -> throw IOException("only ed25519 and rsa keys are supported")
        }
        val label = request.label?.trim().orEmpty()
            .ifEmpty {
                when (type) {
                    "rsa" -> "RSA ${request.bits.takeIf { it != 0 } ?: DEFAULT_RSA_BITS} key"
                    else -> "Ed25519 key"
                }
            }
        return store(pair, type, label, comment, passphrase)
    }

    fun import(request: SshKeyImportRequest): SshKeyInfo {
        val content = request.content?.trim().orEmpty()
        if (content.isEmpty()) throw IOException("key content is required")
        val passphrase = request.passphrase
        val pairs = try {
            org.apache.sshd.common.util.security.SecurityUtils.loadKeyPairIdentities(
                null,
                org.apache.sshd.common.NamedResource.ofName("imported"),
                ByteArrayInputStream(content.toByteArray()),
                if (passphrase.isNullOrEmpty()) {
                    org.apache.sshd.common.config.keys.FilePasswordProvider.EMPTY
                } else {
                    org.apache.sshd.common.config.keys.FilePasswordProvider.of(passphrase)
                }
            )
        } catch (_: Exception) {
            throw IOException("cannot read this private key; check its format and passphrase")
        }
        val pair = pairs.firstOrNull()
            ?: throw IOException("the file contains no private key")
        val type = Crypto.keyType(pair.public)
        val comment = request.label?.trim().orEmpty()
        val label = comment.ifEmpty { "Imported ${type.replaceFirstChar { it.uppercase() }} key" }
        return store(pair, type, label, if (comment.isEmpty()) DEFAULT_COMMENT else comment, passphrase)
    }

    fun delete(id: String): Boolean = synchronized(lock) {
        val keys = read()
        val remaining = keys.filterNot { it.id == id }
        if (remaining.size == keys.size) return false
        write(remaining)
        secrets.delete(SECRET_PREFIX + id)
        true
    }

    /**
     * Rebuilds the identity for a transport. [passphrase] is required only when the
     * key was stored with one; a wrong value is a clear [IOException].
     */
    fun keyPair(id: String, passphrase: String? = null): KeyPair {
        val stored = read().firstOrNull { it.id == id }
            ?: throw IOException("no such SSH key")
        val blob = secrets.get(SECRET_PREFIX + id)
            ?: throw IOException("the private key for this entry is missing")
        val pkcs8 = if (stored.hasPassphrase) {
            if (passphrase.isNullOrEmpty()) {
                throw IOException("this key needs its passphrase")
            }
            Crypto.openWithPassphrase(blob, passphrase.toCharArray())
        } else {
            blob
        }
        val private = Crypto.decodePrivate(stored.type, pkcs8)
        val public = Crypto.decodePublic(stored.publicKey)
        return KeyPair(public, private)
    }

    private fun store(
        pair: KeyPair,
        type: String,
        label: String,
        comment: String,
        passphrase: String?
    ): SshKeyInfo {
        val id = UUID.randomUUID().toString()
        val public = Crypto.encodePublic(pair.public)
        val fingerprint = Crypto.fingerprint(pair.public)
        val pkcs8 = Crypto.encodePrivate(pair)
        val hasPassphrase = !passphrase.isNullOrEmpty()
        val secret = if (hasPassphrase) {
            Crypto.sealWithPassphrase(pkcs8, passphrase.toCharArray())
        } else {
            pkcs8
        }
        val stored = StoredKey(
            id = id,
            label = label,
            type = type,
            fingerprint = fingerprint,
            comment = comment,
            hasPassphrase = hasPassphrase,
            createdAt = System.currentTimeMillis(),
            publicKey = appendComment(public, comment)
        )
        synchronized(lock) {
            secrets.put(SECRET_PREFIX + id, secret)
            write(read() + stored)
        }
        return stored.toInfo()
    }

    private fun appendComment(public: String, comment: String): String =
        if (comment.isBlank()) public else "$public $comment"

    private fun read(): List<StoredKey> {
        if (!metadataFile.isFile) return emptyList()
        return try {
            json.decodeFromString(KeyFile.serializer(), metadataFile.readText()).keys
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun write(keys: List<StoredKey>) {
        if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
            throw IOException("cannot create the ssh directory")
        }
        AtomicWriter.write(
            metadataFile,
            json.encodeToString(KeyFile.serializer(), KeyFile(keys)).toByteArray()
        )
    }

    private fun StoredKey.toInfo(): SshKeyInfo = SshKeyInfo(
        id = id,
        label = label,
        type = type,
        fingerprint = fingerprint,
        comment = comment,
        hasPassphrase = hasPassphrase,
        createdAt = createdAt,
        publicKey = publicKey
    )
}
