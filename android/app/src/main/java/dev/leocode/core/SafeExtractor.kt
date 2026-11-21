package dev.leocode.core

import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Path
import java.nio.file.Paths
import java.nio.file.StandardCopyOption
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.archivers.tar.TarConstants
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream

/**
 * Extracts a runtime `.tar.gz` without trusting any entry (Task 25, P-03).
 *
 * Rejected before anything is written: absolute paths, `..` segments, entries
 * outside the package prefix, symlinks or hardlinks that resolve outside the
 * destination, device nodes and FIFOs, setuid/setgid bits, and packages that
 * exceed the byte, file-count or compression-ratio caps. The destination is
 * canonicalised for every entry, so a link created earlier in the archive
 * cannot be used to write outside the tree.
 */
class SafeExtractor(
    private val maxBytes: Long = 512L * 1024 * 1024,
    private val maxFiles: Int = 60_000,
    private val maxRatio: Long = 200,
    private val maxPathLength: Int = 1024
) {

    data class Result(val files: Int, val bytes: Long)

    internal enum class Kind { DIRECTORY, SYMLINK, HARDLINK, FILE, SPECIAL }

    /** Classify an entry from its tar link flag (not the deprecated isFile). */
    internal fun kindOf(entry: TarArchiveEntry): Kind = when (entry.linkFlag) {
        TarConstants.LF_DIR -> Kind.DIRECTORY
        TarConstants.LF_SYMLINK -> Kind.SYMLINK
        TarConstants.LF_LINK -> Kind.HARDLINK
        TarConstants.LF_NORMAL, TarConstants.LF_OLDNORM -> Kind.FILE
        else -> Kind.SPECIAL
    }

    fun extract(
        artifact: File,
        destination: File,
        manifest: RuntimeManifest,
        onProgress: (bytes: Long, files: Int) -> Unit = { _, _ -> },
        isCancelled: () -> Boolean = { false }
    ): Result {
        if (!destination.isDirectory && !destination.mkdirs()) {
            throw RuntimeInstallException("E_IO", "cannot create the staging directory")
        }
        val root = destination.canonicalFile
        val rootPath = root.toPath()
        var files = 0
        var bytes = 0L
        var lastEmit = 0L

        FileInputStream(artifact).use { fileIn ->
            BufferedInputStream(fileIn).use { buffered ->
                GzipCompressorInputStream(buffered, true).use { gzip ->
                    TarArchiveInputStream(gzip).use { tar ->
                        var entry: TarArchiveEntry? = tar.nextEntry
                        while (entry != null) {
                            if (isCancelled()) {
                                throw RuntimeInstallException("E_CANCELLED", "install cancelled")
                            }
                            val relative = relativeEntryPath(entry.name, manifest)
                            if (relative != null) {
                                if (++files > maxFiles) {
                                    throw RuntimeInstallException(
                                        "E_INTEGRITY",
                                        "package contains more than $maxFiles files"
                                    )
                                }
                                val destinationFile = resolve(root, rootPath, relative)
                                when (kindOf(entry)) {
                                    Kind.DIRECTORY -> {
                                        rejectSpecialMode(entry, relative)
                                        if (!destinationFile.mkdirs() && !destinationFile.isDirectory) {
                                            throw RuntimeInstallException(
                                                "E_IO",
                                                "cannot create a package directory"
                                            )
                                        }
                                    }

                                    Kind.SYMLINK -> {
                                        rejectSpecialMode(entry, relative)
                                        createSymlink(root, rootPath, destinationFile, entry.linkName)
                                    }

                                    Kind.HARDLINK -> {
                                        rejectSpecialMode(entry, relative)
                                        createHardLink(root, rootPath, destinationFile, entry.linkName, manifest)
                                    }

                                    Kind.FILE -> {
                                        rejectSpecialMode(entry, relative)
                                        if (entry.size < 0) {
                                            throw RuntimeInstallException(
                                                "E_INTEGRITY",
                                                "package entry has a negative size: $relative"
                                            )
                                        }
                                        bytes += entry.size
                                        if (bytes > maxBytes) {
                                            throw RuntimeInstallException(
                                                "E_INTEGRITY",
                                                "package expands beyond ${maxBytes / (1024 * 1024)} MB"
                                            )
                                        }
                                        if (artifact.length() > 0 &&
                                            bytes / artifact.length() > maxRatio
                                        ) {
                                            throw RuntimeInstallException(
                                                "E_INTEGRITY",
                                                "package compression ratio is suspicious"
                                            )
                                        }
                                        writeFile(tar, entry, destinationFile, relative)
                                        val now = System.currentTimeMillis()
                                        if (now - lastEmit > 250) {
                                            onProgress(bytes, files)
                                            lastEmit = now
                                        }
                                    }

                                    Kind.SPECIAL -> throw RuntimeInstallException(
                                        "E_INTEGRITY",
                                        "package contains an unsupported entry: $relative"
                                    )
                                }
                            }
                            entry = tar.nextEntry
                        }
                    }
                }
            }
        }

        onProgress(bytes, files)
        return Result(files, bytes)
    }

    /** Strip the archive prefix and drop build leftovers; reject anything odd. */
    internal fun relativeEntryPath(rawName: String, manifest: RuntimeManifest): String? {
        val name = rawName.replace('\\', '/')
        if (name.isEmpty() || name.contains('\u0000')) {
            throw RuntimeInstallException("E_INTEGRITY", "package contains an empty path")
        }
        if (name.startsWith("/")) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "package contains an absolute path"
            )
        }
        if (name.length > maxPathLength) {
            throw RuntimeInstallException("E_INTEGRITY", "package path is too long")
        }
        val parts = name.split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.any { it == ".." }) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "package path escapes the prefix"
            )
        }
        if (parts.isEmpty() || parts.size <= manifest.strip) return null
        if (parts.first() != manifest.prefix) return null
        val relative = parts.drop(manifest.strip).joinToString("/")
        if (relative.isEmpty() || isPruned(relative)) return null
        return relative
    }

    private fun isPruned(relative: String): Boolean {
        if (relative == "include" || relative.startsWith("include/")) return true
        if (relative == "lib/pkgconfig" || relative.startsWith("lib/pkgconfig/")) return true
        // CPython's own test suite is ~38 MB and never needed at runtime.
        if (relative.matches(Regex("lib/python\\d+\\.\\d+/test(/.*)?"))) return true
        return false
    }

    private fun normalizeRelative(path: String): String {
        val parts = path.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.isEmpty() || parts.any { it == ".." }) {
            throw RuntimeInstallException("E_BAD_MANIFEST", "invalid path in manifest: $path")
        }
        return parts.joinToString("/")
    }

    /** Canonical destination; also refuses to write through an existing link. */
    private fun resolve(root: File, rootPath: Path, relative: String): File {
        val destination = File(root, relative).canonicalFile
        if (destination != root && !destination.toPath().startsWith(rootPath)) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "package path escapes the prefix"
            )
        }
        val parent = destination.parentFile?.canonicalFile ?: root
        if (!parent.toPath().startsWith(rootPath)) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "package path escapes the prefix"
            )
        }
        return destination
    }

    private fun rejectSpecialMode(entry: TarArchiveEntry, relative: String) {
        if (entry.mode and SETUID_SETGID != 0) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "package sets a setuid/setgid bit on $relative"
            )
        }
    }

    private fun writeFile(
        tar: TarArchiveInputStream,
        entry: TarArchiveEntry,
        destination: File,
        relative: String
    ) {
        destination.parentFile?.mkdirs()
        FileOutputStream(destination).use { output ->
            val buffer = ByteArray(64 * 1024)
            var written = 0L
            while (written < entry.size) {
                val want = minOf(buffer.size.toLong(), entry.size - written).toInt()
                val read = tar.read(buffer, 0, want)
                if (read < 0) {
                    throw RuntimeInstallException(
                        "E_INTEGRITY",
                        "package entry ended early: $relative"
                    )
                }
                output.write(buffer, 0, read)
                written += read
            }
        }
        if (entry.mode and EXECUTABLE != 0) {
            destination.setExecutable(true, false)
        }
    }

    private fun createSymlink(root: File, rootPath: Path, link: File, rawTarget: String) {
        if (rawTarget.isEmpty() || rawTarget.startsWith("/")) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "package contains an absolute symlink"
            )
        }
        if (rawTarget.length > maxPathLength) {
            throw RuntimeInstallException("E_INTEGRITY", "package symlink target is too long")
        }
        val resolved = File(link.parentFile, rawTarget).canonicalFile
        if (!resolved.toPath().startsWith(rootPath)) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "symlink escapes the prefix"
            )
        }
        link.parentFile?.mkdirs()
        Files.deleteIfExists(link.toPath())
        try {
            Files.createSymbolicLink(link.toPath(), Paths.get(rawTarget))
        } catch (e: Exception) {
            throw RuntimeInstallException("E_IO", "cannot create a package symlink: ${e.message}")
        }
    }

    private fun createHardLink(
        root: File,
        rootPath: Path,
        link: File,
        rawTarget: String,
        manifest: RuntimeManifest
    ) {
        val relativeTarget = relativeEntryPath(rawTarget, manifest)
            ?: throw RuntimeInstallException("E_INTEGRITY", "hardlink points outside the package")
        val target = resolve(root, rootPath, relativeTarget)
        if (!target.isFile || Files.isSymbolicLink(target.toPath())) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "hardlink target is not an extracted regular file"
            )
        }
        link.parentFile?.mkdirs()
        Files.deleteIfExists(link.toPath())
        try {
            Files.createLink(link.toPath(), target.toPath())
        } catch (e: Exception) {
            // Some filesystems refuse hardlinks; a copy keeps the tree usable.
            runCatching {
                Files.copy(
                    target.toPath(),
                    link.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                    StandardCopyOption.COPY_ATTRIBUTES
                )
            }.getOrElse {
                throw RuntimeInstallException("E_IO", "cannot create a package hardlink")
            }
        }
        if (!Files.isRegularFile(link.toPath(), LinkOption.NOFOLLOW_LINKS)) {
            throw RuntimeInstallException("E_IO", "cannot create a package hardlink")
        }
    }

    companion object {
        private const val EXECUTABLE = 0x49 // owner/group/other execute (0o111)
        private const val SETUID_SETGID = 0x1800 // 0o6000
    }
}
