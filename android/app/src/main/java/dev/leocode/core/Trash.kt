package dev.leocode.core

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.UUID

/**
 * Recoverable deletion for the bridge (Task 4).
 *
 * Files are moved into a trash directory on the same filesystem, so the move is a
 * cheap rename. If the rename fails (a filesystem without rename support), the
 * entry is copied first and the original is removed only after the copy succeeded.
 * Nothing is ever deleted permanently by the bridge, and [purge] drops entries
 * older than 30 days.
 */
class Trash(
    private val workspaceTrash: File,
    private val sharedTrash: File? = null
) {

    /** Moves [target] to the trash dir that lives on its filesystem. Returns the trashed entry. */
    fun move(target: File, sharedRoot: File? = null, now: Long = System.currentTimeMillis()): File {
        if (!target.exists() && !isSymlink(target)) {
            throw IOException("no such file: ${target.path}")
        }

        val shared = sharedRoot?.let { canonicalOrNull(it) }
        val useShared = shared != null && sharedTrash != null && isUnder(target, shared)
        val trashDir = if (useShared) sharedTrash!! else workspaceTrash
        if (!trashDir.isDirectory && !trashDir.mkdirs() && !trashDir.isDirectory) {
            throw IOException("cannot create trash dir: ${trashDir.path}")
        }

        val dest = File(trashDir, "$now-${UUID.randomUUID()}-${target.name}")
        if (target.renameTo(dest)) return dest

        try {
            copyRecursively(target, dest)
        } catch (e: IOException) {
            deleteEntry(dest)
            throw e
        }
        if (!deleteEntry(target)) {
            // The copy is safe in the trash; report the failure instead of losing data.
            throw IOException("copied to trash but could not remove ${target.path}")
        }
        return dest
    }

    /** Deletes trash entries older than [maxAgeMs]. Returns how many were removed. */
    fun purge(
        maxAgeMs: Long = DEFAULT_MAX_AGE_MS,
        now: Long = System.currentTimeMillis()
    ): Int {
        var removed = 0
        val cutoff = now - maxAgeMs
        for (dir in listOfNotNull(workspaceTrash, sharedTrash)) {
            if (!dir.isDirectory) continue
            for (entry in dir.listFiles() ?: continue) {
                if (entry.lastModified() < cutoff && deleteEntry(entry)) {
                    removed++
                }
            }
        }
        return removed
    }

    private fun copyRecursively(source: File, dest: File) {
        if (isSymlink(source)) {
            val link = Files.readSymbolicLink(source.toPath())
            Files.deleteIfExists(dest.toPath())
            Files.createSymbolicLink(dest.toPath(), link)
            return
        }
        if (source.isDirectory) {
            if (!dest.isDirectory && !dest.mkdirs() && !dest.isDirectory) {
                throw IOException("cannot create ${dest.path}")
            }
            for (child in source.listFiles() ?: throw IOException("cannot list ${source.path}")) {
                copyRecursively(child, File(dest, child.name))
            }
            return
        }
        source.inputStream().use { input ->
            dest.outputStream().use { output ->
                input.copyTo(output)
                output.flush()
            }
        }
    }

    /** Deletes a link itself, never its target; directories are removed recursively. */
    private fun deleteEntry(file: File): Boolean {
        if (isSymlink(file)) {
            return try {
                Files.deleteIfExists(file.toPath())
                true
            } catch (_: IOException) {
                false
            }
        }
        return file.deleteRecursively()
    }

    private fun isSymlink(file: File): Boolean =
        runCatching { Files.isSymbolicLink(file.toPath()) }.getOrDefault(false)

    private fun canonicalOrNull(file: File): File? =
        runCatching { file.canonicalFile }.getOrNull()

    private fun isUnder(candidate: File, root: File): Boolean {
        val resolved = canonicalOrNull(candidate) ?: return false
        if (resolved == root) return true
        val prefix = if (root.path.endsWith(File.separator)) root.path else root.path + File.separator
        return resolved.path.startsWith(prefix)
    }

    private companion object {
        const val DEFAULT_MAX_AGE_MS = 30L * 24 * 60 * 60 * 1000
    }
}
