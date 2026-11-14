package dev.leocode.workspace

import java.io.File
import java.io.IOException
import java.util.zip.ZipEntry
import java.util.zip.ZipInputStream
import java.util.zip.ZipOutputStream

data class BackupResult(val files: Int, val bytes: Long)

/**
 * Zip backup and restore for a workspace (Task 14).
 *
 * Entries are stored relative to the workspace root with `/` separators.
 * Restore is deliberately strict: absolute paths, `..` segments, device files
 * and entries that resolve outside the destination are rejected before a byte is
 * written. Caps on file count and total extracted size stop a zip bomb, and every
 * regular file is written through a unique temp name so a failed restore never
 * leaves a half-written document.
 */
class ZipBackup(
    private val maxFiles: Int = 20_000,
    private val maxTotalBytes: Long = 512L * 1024 * 1024,
    private val maxEntryBytes: Long = 64L * 1024 * 1024
) {

    companion object {
        private val IGNORED_DIRECTORIES = setOf(".trash", ".leocode-trash")
    }

    fun export(
        sourceRoot: File,
        targetZip: File,
        onProgress: (files: Int, bytes: Long) -> Unit = { _, _ -> }
    ): BackupResult {
        var files = 0
        var bytes = 0L
        targetZip.parentFile?.let { parent ->
            if (!parent.isDirectory && !parent.mkdirs() && !parent.isDirectory) {
                throw IOException("cannot create ${parent.path}")
            }
        }
        ZipOutputStream(targetZip.outputStream().buffered()).use { zip ->
            val root = sourceRoot.canonicalFile
            fun add(file: File, relative: String) {
                if (relative.isEmpty() && file.isDirectory) {
                    file.listFiles()?.sortedBy { it.name }?.forEach { child ->
                        add(child, child.name)
                    }
                    return
                }
                if (file.name in IGNORED_DIRECTORIES) return
                if (file.isDirectory) {
                    val name = "$relative/"
                    zip.putNextEntry(ZipEntry(name))
                    zip.closeEntry()
                    file.listFiles()?.sortedBy { it.name }?.forEach { child ->
                        add(child, "$relative/${child.name}")
                    }
                    return
                }
                if (!file.isFile) return
                val canonical = file.canonicalFile
                if (!canonical.path.startsWith(root.path + File.separator)) {
                    throw IOException("workspace entry escaped the root")
                }
                zip.putNextEntry(ZipEntry(relative))
                file.inputStream().use { input ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        zip.write(buffer, 0, read)
                        bytes += read
                    }
                }
                zip.closeEntry()
                files += 1
                onProgress(files, bytes)
            }
            add(root, "")
        }
        return BackupResult(files, bytes)
    }

    fun restore(
        zipFile: File,
        destination: File,
        onProgress: (files: Int, bytes: Long) -> Unit = { _, _ -> }
    ): BackupResult {
        if (!destination.isDirectory && !destination.mkdirs() && !destination.isDirectory) {
            throw IOException("cannot create ${destination.path}")
        }
        val destRoot = destination.canonicalFile
        var files = 0
        var bytes = 0L

        ZipInputStream(zipFile.inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val name = safeEntryName(entry.name)
                if (name == null) {
                    zip.closeEntry()
                    continue
                }
                if (entry.isDirectory) {
                    val dir = File(destRoot, name)
                    ensureUnder(destRoot, dir)
                    if (!dir.isDirectory && !dir.mkdirs() && !dir.isDirectory) {
                        throw IOException("cannot create a backup directory")
                    }
                    zip.closeEntry()
                    continue
                }

                val target = File(destRoot, name)
                ensureUnder(destRoot, target)
                target.parentFile?.let { parent ->
                    if (!parent.isDirectory && !parent.mkdirs() && !parent.isDirectory) {
                        throw IOException("cannot create a backup directory")
                    }
                }
                val limit = if (maxEntryBytes in 1..Long.MAX_VALUE) maxEntryBytes else Long.MAX_VALUE
                val buffer = ByteArray(64 * 1024)
                var entryBytes = 0L
                // Stream into a unique temp file, then move it into place. A
                // failed restore never leaves a half-written document and a large
                // entry never has to sit in memory.
                val temp = File(target.parentFile, ".${target.name}.${java.util.UUID.randomUUID()}.tmp")
                try {
                    temp.outputStream().buffered().use { fileOut ->
                        while (true) {
                            val read = zip.read(buffer)
                            if (read < 0) break
                            entryBytes += read
                            bytes += read
                            if (entryBytes > limit || bytes > maxTotalBytes) {
                                throw IOException("backup exceeds the size limit")
                            }
                            fileOut.write(buffer, 0, read)
                        }
                    }
                    if (entry.time > 0) temp.setLastModified(entry.time)
                    java.nio.file.Files.move(
                        temp.toPath(),
                        target.toPath(),
                        java.nio.file.StandardCopyOption.REPLACE_EXISTING
                    )
                } finally {
                    temp.delete()
                }
                files += 1
                if (files > maxFiles) throw IOException("backup has too many files")
                zip.closeEntry()
                onProgress(files, bytes)
            }
        }
        return BackupResult(files, bytes)
    }

    /**
     * Returns the normalised relative entry name, or null when the entry must be
     * skipped. Rejects absolute paths, drive letters, NUL bytes and `..` segments.
     */
    private fun safeEntryName(raw: String): String? {
        if (raw.isEmpty() || raw.contains('\u0000')) return null
        val normalised = raw.replace('\\', '/')
        if (normalised.startsWith("/") || Regex("^[A-Za-z]:").containsMatchIn(normalised)) {
            return null
        }
        val parts = normalised.split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.isEmpty() || parts.any { it == ".." }) return null
        if (parts.any { it in IGNORED_DIRECTORIES }) return null
        return parts.joinToString("/")
    }

    private fun ensureUnder(root: File, target: File) {
        val canonical = target.canonicalFile
        if (canonical != root && !canonical.path.startsWith(root.path + File.separator)) {
            throw IOException("backup entry escapes the destination")
        }
    }
}
