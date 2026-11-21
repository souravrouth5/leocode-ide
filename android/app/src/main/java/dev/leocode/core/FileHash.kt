package dev.leocode.core

import java.io.File
import java.io.IOException
import java.io.InputStream
import java.security.MessageDigest

/**
 * SHA-256 helpers used by conflict detection and file stats (Task 15).
 *
 * A hex digest is stable across devices and cheap to compare on the web side.
 * Hashing is streamed, so a large file never has to be loaded into memory.
 */
object FileHash {

    private const val BUFFER = 64 * 1024

    fun sha256(bytes: ByteArray): String = digest().apply { update(bytes) }.digest().toHex()

    fun sha256(text: String): String = sha256(text.toByteArray(Charsets.UTF_8))

    fun sha256(file: File): String = file.inputStream().use { sha256(it) }

    fun sha256(input: InputStream): String {
        val digest = digest()
        val buffer = ByteArray(BUFFER)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().toHex()
    }

    /**
     * Digest of at most [limit] bytes plus a marker when the file is longer.
     * Used for large files where hashing everything on every stat is wasteful.
     */
    fun sha256Bounded(file: File, limit: Long): String = file.inputStream().use { input ->
        val digest = digest()
        val buffer = ByteArray(BUFFER)
        var total = 0L
        while (total < limit) {
            val read = input.read(buffer, 0, minOf(buffer.size.toLong(), limit - total).toInt())
            if (read < 0) break
            digest.update(buffer, 0, read)
            total += read
        }
        if (file.length() > limit) digest.update(0)
        digest.digest().toHex()
    }

    private fun digest(): MessageDigest = MessageDigest.getInstance("SHA-256")

    private fun ByteArray.toHex(): String = joinToString("") { byte ->
        "%02x".format(byte)
    }

    /** Converts an I/O failure into the bridge's own unchecked signal. */
    fun safeHash(file: File): String? = try {
        sha256(file)
    } catch (_: IOException) {
        null
    } catch (_: SecurityException) {
        null
    }
}
