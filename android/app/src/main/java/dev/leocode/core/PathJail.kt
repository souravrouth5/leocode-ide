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
