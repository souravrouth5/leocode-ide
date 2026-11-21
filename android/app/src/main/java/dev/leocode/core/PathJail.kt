package dev.leocode.core

import java.io.File
import java.io.IOException

/**
 * Single authority for bridge file paths (Task 4).
 *
 * A path is allowed when its canonical form (symlinks and `..` resolved) equals an
 * allowed root or sits below it. Roots are the workspace parent plus shared storage,
 * the latter only while the storage permission is granted right now.
 */
class PathJail(
    private val workspaceRoot: File,
    /** Shared-storage root, also used by handlers that route deletes to the shared trash. */
    val sharedStorageRoot: File? = null,
    private val storageGranted: () -> Boolean = { false }
) {

    /** Canonical roots valid right now. The permission state is read on every call. */
    fun allowedRoots(): List<File> {
        val workspace = canonical(workspaceRoot)
        val roots = mutableListOf(workspace)
        if (storageGranted()) {
            sharedStorageRoot?.let { shared ->
                val canonicalShared = canonical(shared)
                if (canonicalShared != workspace) roots += canonicalShared
            }
        }
        return roots
    }

    /** Canonical absolute [rawPath] under an allowed root, or throw. */
    fun resolve(rawPath: String, base: File = workspaceRoot): File {
        val raw = if (rawPath.isEmpty()) "." else rawPath
        if (raw.contains('\u0000')) {
            throw SecurityException("path contains NUL")
        }
        val candidate = try {
            val file = if (File(raw).isAbsolute) File(raw) else File(base, raw)
            file.canonicalFile
        } catch (e: IOException) {
            throw SecurityException("cannot resolve path: $raw", e)
        }
        if (!underAnyRoot(candidate, allowedRoots())) {
            throw SecurityException("path outside root: $raw")
        }
        return candidate
    }

    /**
     * Canonical parent plus the unresolved last name: the path to act on when the
     * operation must touch the directory entry itself instead of what a symlink
     * points at (delete, rename). [resolve] follows the final component, so
     * `fs.delete` on `notes -> real/notes.txt` would trash the target and leave a
     * dangling link, and a link that points outside the jail could never be
     * removed at all (S-05).
     *
     * The parent is canonicalised and must sit under an allowed root; the last
     * component must be one plain name. `.` and `..` name a directory rather than
     * an entry, so they are resolved fully and the caller's own protected-root
     * checks decide.
     *
     * Throws [SecurityException] when the parent is outside every allowed root or
     * the last component is not a plain name.
     */
    fun resolveEntry(rawPath: String, base: File = workspaceRoot): File {
        val raw = if (rawPath.isEmpty()) "." else rawPath
        if (raw.contains('\u0000')) {
            throw SecurityException("path contains NUL")
        }
        val candidate = if (File(raw).isAbsolute) File(raw) else File(base, raw)
        val name = candidate.name
        if (name.isEmpty() || name == "." || name == "..") {
            return resolve(raw, base)
        }
        // The name comes from File.name, so it cannot contain a separator; the
        // check keeps it that way if that ever changes.
        if (name.contains('/') || name.contains(File.separatorChar)) {
            throw SecurityException("path does not end in a single name: $raw")
        }
        val parent = try {
            candidate.parentFile?.canonicalFile
        } catch (e: IOException) {
            throw SecurityException("cannot resolve parent of: $raw", e)
        } ?: throw SecurityException("path has no parent: $raw")
        if (!underAnyRoot(parent, allowedRoots())) {
            throw SecurityException("path outside root: $raw")
        }
        return File(parent, name)
    }

    /** True when [candidate] canonicalises to an allowed root or a descendant. */
    fun isAllowed(candidate: File): Boolean {
        val canonicalCandidate = try {
            candidate.canonicalFile
        } catch (e: IOException) {
            return false
        }
        val roots = try {
            allowedRoots()
        } catch (e: SecurityException) {
            return false
        }
        return underAnyRoot(canonicalCandidate, roots)
    }

    private fun underAnyRoot(candidate: File, roots: List<File>): Boolean =
        roots.any { isUnder(candidate, it) }

    /** Prefix check uses root + separator, so `workspacesX` never matches `workspaces`. */
    private fun isUnder(candidate: File, root: File): Boolean {
        if (candidate == root) return true
        val rootPath = root.path
        val prefix = if (rootPath.endsWith(File.separator)) rootPath else rootPath + File.separator
        return candidate.path.startsWith(prefix)
    }

    private fun canonical(file: File): File = try {
        file.canonicalFile
    } catch (e: IOException) {
        throw SecurityException("cannot resolve root: ${file.path}", e)
    }
}
