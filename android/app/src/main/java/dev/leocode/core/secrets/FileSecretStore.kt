package dev.leocode.core.secrets

import dev.leocode.core.AtomicWriter
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets

/**
 * One ciphertext file per secret, under `filesDir/secrets/` (Task 20, D-009).
 *
 * A secret id is an opaque string chosen by the caller (`token:github.com`,
 * `ssh-key:<uuid>`). The file name is the hex encoding of the id's UTF-8 bytes,
 * so [ids] can recover the list without a plaintext index; the secret value
 * itself only ever exists on disk as the ciphertext produced by [SecretCipher].
 *
 * Writes go through [AtomicWriter]: a crash leaves either the old ciphertext or
 * the new one. A blob that cannot be opened (corrupt file, key from another
 * install) reads as `null`; [SecretUnavailableException] is the one failure that
 * propagates, because the whole store is unusable and the UI must say so.
 *
 * This class is pure Java/Kotlin (no Android framework types) so it runs in JVM
 * tests with a fake cipher.
 */
class FileSecretStore(
    private val root: File,
    private val cipher: SecretCipher
) {

    companion object {
        /** Keeps the hex file name inside the 255-byte name limit of common filesystems. */
        const val MAX_ID_BYTES = 120

        private const val EXT = ".bin"

        /** Serialises list/delete against concurrent writes in this process. */
        private val LOCK = Any()
    }

    /** Writes [secret] under [id], replacing any previous value. */
    fun put(id: String, secret: ByteArray) {
        val file = fileFor(id)
        val directory = file.parentFile
            ?: throw IOException("secret store has no directory")
        if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) {
            throw IOException("cannot create the secrets directory")
        }
        val blob = cipher.seal(secret)
        AtomicWriter.write(file, blob)
        restrictPermissions(file)
    }

    /** Returns the decrypted secret, or `null` when [id] is unknown or unreadable. */
    fun get(id: String): ByteArray? {
        val file = fileFor(id)
        if (!file.isFile) return null
        val blob = try {
            file.readBytes()
        } catch (_: IOException) {
            return null
        }
        return try {
            cipher.open(blob)
        } catch (e: SecretUnavailableException) {
            throw e
        } catch (_: Exception) {
            // Corrupt or foreign ciphertext: the caller sees "no secret", not a crash.
            null
        }
    }

    fun delete(id: String): Boolean {
        val file = fileFor(id)
        return file.isFile && file.delete()
    }

    fun has(id: String): Boolean = fileFor(id).isFile

    /** Ids with a stored blob, sorted for a stable reply. */
    fun ids(): List<String> = synchronized(LOCK) {
        val files = root.listFiles() ?: return emptyList()
        files.asSequence()
            .filter { it.isFile && it.name.endsWith(EXT) }
            .mapNotNull { decodeId(it.name.removeSuffix(EXT)) }
            .sorted()
            .toList()
    }

    /** Deletes every secret whose id starts with [prefix]; used by workspace/remote cleanup. */
    fun deleteWhere(prefix: String): Int = synchronized(LOCK) {
        var removed = 0
        for (id in ids()) {
            if (id.startsWith(prefix) && delete(id)) removed++
        }
        removed
    }

    private fun fileFor(id: String): File {
        require(id.isNotBlank()) { "a secret needs an id" }
        val bytes = id.toByteArray(StandardCharsets.UTF_8)
        require(bytes.size <= MAX_ID_BYTES) { "secret id is too long" }
        return File(root, encodeHex(bytes) + EXT)
    }

    private fun restrictPermissions(file: File) {
        // Best effort: the content is ciphertext, but a private mode is still the
        // right default and costs nothing on Android's ext4/f2fs.
        runCatching {
            file.setReadable(false, false)
            file.setReadable(true, true)
            file.setWritable(false, false)
            file.setWritable(true, true)
        }
    }

    private fun encodeHex(bytes: ByteArray): String {
        val digits = "0123456789abcdef"
        val out = StringBuilder(bytes.size * 2)
        for (byte in bytes) {
            val value = byte.toInt() and 0xff
            out.append(digits[value ushr 4])
            out.append(digits[value and 0x0f])
        }
        return out.toString()
    }

    private fun decodeId(name: String): String? {
        if (name.isEmpty() || name.length % 2 != 0) return null
        val bytes = ByteArray(name.length / 2)
        for (index in bytes.indices) {
            val high = hexValue(name[index * 2])
            val low = hexValue(name[index * 2 + 1])
            if (high < 0 || low < 0) return null
            bytes[index] = ((high shl 4) or low).toByte()
        }
        return try {
            String(bytes, StandardCharsets.UTF_8).takeIf { it.isNotBlank() }
        } catch (_: Exception) {
            null
        }
    }

    private fun hexValue(char: Char): Int = when (char) {
        in '0'..'9' -> char - '0'
        in 'a'..'f' -> char - 'a' + 10
        in 'A'..'F' -> char - 'A' + 10
        else -> -1
    }
}
