package dev.leocode.core

import java.io.File

/**
 * Deletes stale SAF scratch entries at startup (PD-07).
 *
 * Import staging directories (`tmp/import-*`), export archives
 * (`tmp/backup-*`), restore archives (`cacheDir/restore-*`) and the per-entry
 * restore temps (`tmp/.name.<uuid>.tmp`) are all best-effort: a process death,
 * a killed Activity or a provider failure can leave one behind, and the restore
 * copy alone can be up to 512 MB. Nothing else sweeps them, so [LeoApp] runs
 * this once on its background reaper thread.
 *
 * Only entries whose name starts with one of the given prefixes are touched,
 * and only when their last-modified time is at least [ttlMs] old. The default
 * TTL is one hour, far longer than any import/export/restore of a phone-sized
 * workspace, so an operation started by a previous Activity instance is not
 * deleted while it is still running.
 *
 * Pure JVM with an injectable clock; failures are swallowed per entry so a
 * permission problem never escapes into application startup.
 */
class ScratchSweeper(
    private val ttlMs: Long = DEFAULT_TTL_MS,
    private val clock: () -> Long = { System.currentTimeMillis() }
) {

    companion object {
        /** Generous enough for a long import on a slow provider. */
        const val DEFAULT_TTL_MS = 60L * 60 * 1000

        /**
         * The directories and prefixes swept at startup (PD-07/PD-22).
         *
         * Restore archives live in [cacheDir]; import staging, export archives
         * and the per-entry restore temps live under [scratchDir]. A restore
         * temp is a hidden `.name.<uuid>.tmp` file (see `ZipBackup.restore`), so
         * its prefix is `.` and nothing else written there starts with a dot.
         */
        fun defaultRules(cacheDir: File, scratchDir: File): List<Rule> = listOf(
            Rule(cacheDir, listOf("restore-")),
            Rule(scratchDir, listOf("backup-", "import-", "."))
        )
    }

    /** A directory and the file-name prefixes that are stale inside it. */
    data class Rule(val directory: File, val prefixes: List<String>)

    /**
     * Sweeps one directory. Returns how many entries were removed; a missing or
     * unreadable directory is not an error.
     */
    fun sweep(directory: File, prefixes: List<String>): Int =
        sweep(listOf(Rule(directory, prefixes)))

    /** Sweeps several directories; returns the total number of removed entries. */
    fun sweep(rules: List<Rule>): Int {
        var removed = 0
        for (rule in rules) {
            val entries = runCatching { rule.directory.listFiles() }.getOrNull() ?: continue
            for (entry in entries) {
                if (rule.prefixes.none { entry.name.startsWith(it) }) continue
                val modified = runCatching { entry.lastModified() }.getOrDefault(0L)
                // A timestamp of 0 means "unknown"; never delete what cannot be aged.
                if (modified <= 0L) continue
                val age = clock() - modified
                if (age < ttlMs) continue
                if (ImportStaging.deleteRecursively(entry)) removed += 1
            }
        }
        return removed
    }
}
