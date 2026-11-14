package dev.leocode.core

import java.io.File

/**
 * Records the pid and `/proc` start time of a child process group (Task 10).
 *
 * A pid alone is not enough to identify an orphan: Android reuses pids, so a
 * stale file could otherwise kill an unrelated process. The start time (field 22
 * of `/proc/<pid>/stat`) makes the identity stable across pid reuse.
 */
class PidFileStore(private val dir: File) {

    data class Record(val id: String, val pid: Int, val startTime: Long, val kind: String)

    fun write(id: String, pid: Int, kind: String) {
        if (pid <= 0) return
        val start = ProcessStartTime.read(pid) ?: 0L
        runCatching {
            dir.mkdirs()
            val target = fileFor(id)
            val temp = File(dir, "$id.pid.tmp")
            temp.writeText("$pid $start $kind\n")
            if (!temp.renameTo(target)) {
                target.delete()
                temp.delete()
            }
        }
    }

    fun remove(id: String) {
        runCatching { fileFor(id).delete() }
    }

    fun fileFor(id: String): File = File(dir, "$id.pid")

    /** Existing pidfiles, newest or oldest order is unspecified. */
    fun list(): List<File> =
        dir.listFiles { file -> file.isFile && file.name.endsWith(".pid") }?.toList()
            ?: emptyList()

    fun parse(file: File): Record? = runCatching {
        val parts = file.readText().trim().split(Regex("\\s+"))
        if (parts.size < 2) return@runCatching null
        val pid = parts[0].toIntOrNull() ?: return@runCatching null
        if (pid <= 0) return@runCatching null
        val start = parts[1].toLongOrNull() ?: 0L
        val kind = parts.getOrNull(2) ?: "unknown"
        Record(file.nameWithoutExtension, pid, start, kind)
    }.getOrNull()
}
