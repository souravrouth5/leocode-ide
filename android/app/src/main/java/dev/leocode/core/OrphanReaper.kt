package dev.leocode.core

/**
 * Kills process groups left behind by a previous app process (Task 10).
 *
 * Terminals and `proc.run` jobs write a pidfile while they are alive. If LeoCode
 * is killed without waiting (low-memory kill, crash, force stop from the task
 * switcher) the children can be reparented and keep running. On the next start
 * [reap] sends SIGTERM to the old group, then SIGKILL, and deletes the file.
 *
 * Pid reuse is guarded by the start time captured in the pidfile. An orphan whose
 * pid now belongs to a different process is left alone.
 */
class OrphanReaper(
    private val store: PidFileStore,
    private val kill: (pid: Int, signal: Int) -> Unit = { pid, signal ->
        if (!NativePty.available()) throw IllegalStateException("native PTY unavailable")
        NativePty.killGroup(pid, signal)
    },
    private val startTime: (pid: Int) -> Long? = ProcessStartTime::read,
    private val sleep: (millis: Long) -> Unit = { Thread.sleep(it) }
) {

    private companion object {
        const val SIGTERM = 15
        const val SIGKILL = 9
        const val GRACE_MS = 200L
    }

    /** Reaps every live orphan recorded in the store and returns how many were signalled. */
    fun reap(): Int {
        var killed = 0
        val (selfPid, selfGroup) = ProcessStartTime.selfIds() ?: (-1 to -1)
        for (file in store.list()) {
            val record = store.parse(file)
            if (record == null) {
                file.delete()
                continue
            }
            // Root orphans are handled lazily by RootOrphanReaper; normal reap cannot signal them (B3).
            if (record.kind == "root-proc" || record.kind == "root-term") {
                file.delete()
                continue
            }
            // `kill(-1)` and `kill(-ownPid)` are never valid (L-01).
            if (!isSafePid(record.pid, selfPid, selfGroup)) {
                file.delete()
                continue
            }
            val current = startTime(record.pid)
            // A zero/unknown start time cannot prove identity, so keep the
            // process: pid reuse would otherwise target an unrelated one (L-07).
            val sameProcess = current != null &&
                record.startTime > 0L && current == record.startTime
            if (sameProcess) {
                runCatching {
                    kill(record.pid, SIGTERM)
                    sleep(GRACE_MS)
                    if (startTime(record.pid) != null) kill(record.pid, SIGKILL)
                    killed++
                }
            }
            file.delete()
        }
        return killed
    }

    private fun isSafePid(pid: Int, selfPid: Int, selfGroup: Int): Boolean =
        pid > 1 && pid != selfPid && pid != selfGroup
}
