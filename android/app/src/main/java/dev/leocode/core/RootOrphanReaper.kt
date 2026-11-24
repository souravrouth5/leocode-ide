package dev.leocode.core

import java.io.File

/**
 * Reaps root process groups left behind by a previous app process (B3, R-06).
 *
 * Root processes run under a different UID and cannot be signalled or inspected
 * by the normal [OrphanReaper]. This reaper inspects root pid files in [dir]
 * and kills surviving root groups using [rootManager].
 *
 * Startup must not run `su`, so this reaper is lazy: it runs only when
 * [RootManager.canUseRoot] is true (e.g. before the first root job/terminal
 * starts or after a successful root grant).
 */
class RootOrphanReaper(
    private val dir: File,
    private val rootManager: RootManager,
    private val isActive: (id: String) -> Boolean = { false },
    private val sleep: (Long) -> Unit = { Thread.sleep(it) }
) {

    private companion object {
        const val SIGTERM = 15
        const val SIGKILL = 9
        const val GRACE_MS = 200L
    }

    /**
     * Reaps any pending root orphans recorded in [dir].
     *
     * If root cannot be used ([RootManager.canUseRoot] is false), does nothing
     * and keeps the files. Otherwise, checks each recorded root pid: if alive,
     * signals SIGTERM, waits [GRACE_MS], and signals SIGKILL if still alive.
     * In every case when root can be used, the pidfile is deleted.
     *
     * Returns the count of orphaned root processes signalled.
     */
    fun reapPending(): Int {
        if (!rootManager.canUseRoot()) return 0
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".pid") } ?: return 0
        var reaped = 0
        for (file in files) {
            val id = file.name.removeSuffix(".pid")
            if (isActive(id)) {
                continue
            }
            try {
                val text = runCatching { file.readText() }.getOrNull()
                val rootPid = text?.let { RootManager.parseRootPidFile(it) }
                if (rootPid != null && rootManager.isRootPidAlive(rootPid)) {
                    rootManager.killSession(rootPid.pid, SIGTERM)
                    sleep(GRACE_MS)
                    rootManager.killSession(rootPid.pid, SIGKILL)
                    reaped++
                }
            } finally {
                runCatching { file.delete() }
            }
        }
        return reaped
    }
}
