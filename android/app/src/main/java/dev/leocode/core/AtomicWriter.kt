package dev.leocode.core

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

/**
 * Crash-safe replacement for workspace files.
 *
 * The bytes go to a unique temp file in the target's own directory, are fsynced,
 * and the temp file is then renamed over the target in one step. A reader sees
 * either the old file or the new one, never a truncated file; a failed write
 * leaves the old target intact and removes the temp file. The caller owns
 * directory creation: a missing parent is an error, never a silent mkdir.
 */
object AtomicWriter {

    /** Writes [bytes] to [target], replacing any existing file atomically. */
    fun write(target: File, bytes: ByteArray) {
        val destination = target.absoluteFile
        val parent = destination.parentFile
            ?: throw IOException("no parent directory for ${target.path}")
        if (!parent.isDirectory) {
            throw IOException("parent directory does not exist: ${parent.path}")
        }

        // Unique per writer: concurrent writes to the same target never share a temp path.
        val tmp = File(parent, ".${destination.name}.${UUID.randomUUID()}.tmp")
        try {
            FileOutputStream(tmp).use { out ->
                out.write(bytes)
                out.flush()
                out.fd.sync()
            }
            moveReplacing(tmp, destination)
        } finally {
            if (tmp.exists()) {
                tmp.delete()
            }
        }
    }

    private fun moveReplacing(tmp: File, target: File) {
        try {
            Files.move(
                tmp.toPath(),
                target.toPath(),
                StandardCopyOption.ATOMIC_MOVE,
                StandardCopyOption.REPLACE_EXISTING
            )
        } catch (e: AtomicMoveNotSupportedException) {
            // Some filesystems cannot rename atomically; replace in one call anyway.
            Files.move(tmp.toPath(), target.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
    }
}
