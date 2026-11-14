package dev.leocode.core

import java.io.File

/** Reads Linux process identity from `/proc` without Android APIs. */
object ProcessStartTime {

    /**
     * Field 22 of `/proc/<pid>/stat` (process start time in clock ticks) or null
     * when the process is gone. The comm field (2) can contain spaces and `)`,
     * so parsing starts after the last closing parenthesis.
     */
    fun read(pid: Int): Long? {
        if (pid <= 0) return null
        return runCatching {
            val stat = File("/proc/$pid/stat").readText()
            val close = stat.lastIndexOf(')')
            if (close < 0 || close + 2 >= stat.length) return@runCatching null
            val fields = stat.substring(close + 2).trim().split(Regex("\\s+"))
            // fields[0] is state (field 3); starttime is field 22 -> index 19.
            fields.getOrNull(19)?.toLongOrNull()
        }.getOrNull()
    }

    fun matches(pid: Int, startTime: Long): Boolean {
        val current = read(pid) ?: return false
        return startTime <= 0L || current == startTime
    }

    /** pid and process-group id from `/proc/<pid>/stat` (fields 1 and 5). */
    fun ids(pid: Int): Pair<Int, Int>? {
        if (pid <= 0) return null
        return runCatching { parseIds(File("/proc/$pid/stat").readText()) }.getOrNull()
    }

    fun selfIds(): Pair<Int, Int>? =
        runCatching { parseIds(File("/proc/self/stat").readText()) }.getOrNull()

    private fun parseIds(stat: String): Pair<Int, Int>? {
        val close = stat.lastIndexOf(')')
        if (close < 0 || close + 2 >= stat.length) return null
        val fields = stat.substring(close + 2).trim().split(Regex("\\s+"))
        // fields[0] = state, [1] = ppid, [2] = pgrp; the pid is before the comm.
        val pid = stat.substringBefore(' ').toIntOrNull() ?: return null
        val pgrp = fields.getOrNull(2)?.toIntOrNull() ?: return null
        return pid to pgrp
    }
}
