package dev.leocode.core

import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.UUID

/**
 * Import staging and cap accounting for `saf.importTree` (PD-06).
 *
 * The SAF provider is copied into a throw-away directory under `workspace.tmp`
 * first, then the finished tree is moved into the workspace. A provider error
 * or a cap hit therefore leaves the workspace unchanged: the Activity deletes
 * the staging directory in a `finally` block and rethrows the real reason.
 *
 * The move helpers never overwrite an existing entry. They reuse the naming
 * scheme the import always had (`name`, then `name-2`, `name-3` for folders and
 * `stem-2.ext` for files) so an import produces the same names as before.
 *
 * Pure JVM so the naming, move and cap rules are unit-testable without an
 * Activity or a SAF provider.
 */
object ImportStaging {

    /** Only files, not directories, count towards the cap. */
    const val MAX_FILES = 20_000
    const val MAX_BYTES = 512L * 1024 * 1024
    const val MAX_DEPTH = 64

    /** Messages are part of the fix: SafHandler maps them to `E_LIMIT` reasons. */
    const val LIMIT_MESSAGE = "the import exceeds the file or size limit"
    const val DEPTH_MESSAGE = "the folder is nested too deeply"

    /** Creates a fresh, empty staging directory under [scratchRoot]. */
    fun createStaging(scratchRoot: File): File {
        if (!scratchRoot.isDirectory && !scratchRoot.mkdirs() && !scratchRoot.isDirectory) {
            throw IOException("cannot create the import staging area")
        }
        val staging = File(scratchRoot, "import-${UUID.randomUUID()}")
        if (!staging.mkdirs() && !staging.isDirectory) {
            throw IOException("cannot create the import staging area")
        }
        return staging
    }

    /** Moves the staged tree to `<parent>/<desired>[-n]` and returns the target. */
    fun moveIntoWorkspace(staged: File, parent: File, desired: String): File {
        var counter = 1
        while (counter <= 10_000) {
            val name = if (counter == 1) desired else "$desired-$counter"
            val target = File(parent, name)
            if (!target.exists()) {
                if (staged.renameTo(target)) return target
                // A rename that failed because the name appeared in the race is
                // retried with the next suffix; anything else is a real failure.
                if (!target.exists()) {
                    throw IOException("cannot move the imported folder into the workspace")
                }
            }
            counter += 1
        }
        throw IOException("cannot move the imported folder into the workspace")
    }

    /**
     * Moves every top-level child of [staged] into [dest], giving each a unique
     * name. Used when the caller picked an existing destination folder.
     *
     * All moves are undone if one fails, so the destination is left as it was;
     * the caller then deletes the staging directory.
     */
    fun moveChildren(staged: File, dest: File): List<File> {
        val moved = ArrayList<Pair<File, File>>()
        val claimed = HashSet<String>()
        try {
            val children = staged.listFiles()?.sortedBy { it.name }
                ?: throw IOException("cannot read the import staging folder")
            for (child in children) {
                val name = availableName(dest, child.name, child.isDirectory, claimed)
                val target = File(dest, name)
                if (!child.renameTo(target)) {
                    throw IOException("cannot move the imported content into the folder")
                }
                moved += child to target
            }
            return moved.map { it.second }
        } catch (error: Throwable) {
            // Best effort: if the rollback itself fails the caller still removes
            // the staging tree, and the remaining entries stay visible in dest.
            for ((source, target) in moved.asReversed()) {
                runCatching { target.renameTo(source) }
            }
            throw error
        }
    }

    /**
     * Deletes an entry and everything below it. A missing entry is a no-op.
     * Symlinks are removed, never followed. Returns true when nothing is left.
     */
    fun deleteRecursively(entry: File): Boolean {
        if (runCatching { Files.isSymbolicLink(entry.toPath()) }.getOrDefault(false)) {
            entry.delete()
            return !entry.exists()
        }
        if (!entry.exists()) return true
        val children = runCatching { entry.listFiles() }.getOrNull()
        if (children != null) {
            for (child in children) deleteRecursively(child)
        }
        entry.delete()
        return !entry.exists()
    }

    /** First free name in [parent], using the import's historical suffixes. */
    internal fun availableName(
        parent: File,
        desired: String,
        directory: Boolean,
        claimed: MutableSet<String> = HashSet()
    ): String {
        var candidate = desired
        var counter = 2
        while (candidate in claimed || File(parent, candidate).exists()) {
            candidate = if (directory) {
                "$desired-$counter"
            } else {
                numberedFile(desired, counter)
            }
            counter += 1
        }
        claimed += candidate
        return candidate
    }

    /** `notes.txt` + 2 → `notes-2.txt`; `README` + 2 → `README-2`. */
    private fun numberedFile(desired: String, counter: Int): String {
        val dot = desired.lastIndexOf('.')
        return if (dot > 0) {
            desired.substring(0, dot) + "-" + counter + desired.substring(dot)
        } else {
            "$desired-$counter"
        }
    }
}

/**
 * Counts what an import has copied so far and enforces the limits.
 *
 * Both overruns throw [IllegalStateException] with the fixed messages above:
 * the import runs in the Activity, but [dev.leocode.bridge.SafHandler] maps the
 * type to `E_LIMIT` and its message to the user-facing reason.
 */
class ImportBudget(
    private val maxFiles: Int = ImportStaging.MAX_FILES,
    private val maxBytes: Long = ImportStaging.MAX_BYTES,
    private val maxDepth: Int = ImportStaging.MAX_DEPTH
) {

    var files: Int = 0
        private set

    var bytes: Long = 0L
        private set

    fun checkDepth(depth: Int) {
        if (depth > maxDepth) throw IllegalStateException(ImportStaging.DEPTH_MESSAGE)
    }

    /** Records one completed file; throws once the file cap is exceeded. */
    fun addFile() {
        files += 1
        if (files > maxFiles) throw IllegalStateException(ImportStaging.LIMIT_MESSAGE)
    }

    /** Records copied bytes; throws once the byte cap is exceeded. */
    fun addBytes(count: Long) {
        bytes += count
        if (bytes > maxBytes) throw IllegalStateException(ImportStaging.LIMIT_MESSAGE)
    }
}
