package dev.leocode.core

import dev.leocode.bridge.BridgeException
import dev.leocode.bridge.ErrorCode
import java.io.File
import java.io.InputStream
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

/**
 * Root execution and privilege manager (D-011, Tasks 17 & 18).
 *
 * Rules:
 * - Never trigger an unsolicited prompt: detection only inspects binary paths.
 * - Root state is strictly opt-in; when disabled, no root invocation is made.
 * - Command execution uses robust POSIX single-quote escaping for argv.
 * - Process cancellation kills the root process group via `su` (since app UID
 *   lacks permission to signal root processes).
 */
class RootManager(
    private val prefs: RootPrefs,
    private val shellRunner: ShellRunner = ProcessShellRunner(),
    private val pathCandidates: List<String> = DEFAULT_SU_PATHS,
    private val pathEnv: String? = System.getenv("PATH")
) {

    @Volatile
    private var grantCache: Boolean? = null

    interface RootPrefs {
        fun isEnabled(): Boolean
        fun setEnabled(enabled: Boolean)
    }

    interface ShellRunner {
        fun run(command: List<String>, timeoutMs: Long = 10_000): ShellResult
    }

    data class ShellResult(val exitCode: Int, val stdout: String, val stderr: String)

    class ProcessShellRunner(
        private val start: (List<String>) -> Process = { ProcessBuilder(it).start() }
    ) : ShellRunner {

        companion object {
            private const val MAX_BUFFER_BYTES = 64 * 1024 // 64 KiB
            private const val JOIN_TIMEOUT_MS = 500L
        }

        override fun run(command: List<String>, timeoutMs: Long): ShellResult {
            return try {
                val process = start(command)
                // Close the child's stdin right away
                runCatching { process.outputStream.close() }

                val stdoutBuf = ByteArrayOutputStream()
                val stderrBuf = ByteArrayOutputStream()

                fun drain(stream: InputStream, buffer: ByteArrayOutputStream): Thread {
                    return Thread {
                        try {
                            val chunk = ByteArray(8192)
                            var read: Int
                            var captured = 0
                            while (stream.read(chunk).also { read = it } != -1) {
                                if (captured < MAX_BUFFER_BYTES) {
                                    val toWrite = minOf(read, MAX_BUFFER_BYTES - captured)
                                    synchronized(buffer) {
                                        buffer.write(chunk, 0, toWrite)
                                    }
                                    captured += toWrite
                                }
                            }
                        } catch (_: Exception) {
                        } finally {
                            runCatching { stream.close() }
                        }
                    }.apply {
                        isDaemon = true
                        start()
                    }
                }

                val stdoutThread = drain(process.inputStream, stdoutBuf)
                val stderrThread = drain(process.errorStream, stderrBuf)

                val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
                if (!finished) {
                    process.destroyForcibly()
                    joinThreads(stdoutThread, stderrThread, JOIN_TIMEOUT_MS)
                    val capturedStdout = synchronized(stdoutBuf) { stdoutBuf.toString(Charsets.UTF_8.name()) }
                    ShellResult(-1, capturedStdout, "timeout after ${timeoutMs}ms")
                } else {
                    joinThreads(stdoutThread, stderrThread, JOIN_TIMEOUT_MS)
                    val stdout = synchronized(stdoutBuf) { stdoutBuf.toString(Charsets.UTF_8.name()) }
                    val stderr = synchronized(stderrBuf) { stderrBuf.toString(Charsets.UTF_8.name()) }
                    ShellResult(process.exitValue(), stdout, stderr)
                }
            } catch (e: Exception) {
                ShellResult(-1, "", e.message ?: "execution failed")
            }
        }

        private fun joinThreads(t1: Thread, t2: Thread, maxWaitMs: Long) {
            val deadline = System.currentTimeMillis() + maxWaitMs
            fun joinOne(t: Thread) {
                val remaining = deadline - System.currentTimeMillis()
                if (remaining > 0) {
                    runCatching { t.join(remaining) }
                }
            }
            joinOne(t1)
            joinOne(t2)
        }
    }

    data class Status(
        val available: Boolean,
        val granted: Boolean,
        val enabled: Boolean
    )

    data class RootPid(val pid: Int, val startTime: Long)

    companion object {
        val DEFAULT_SU_PATHS = listOf(
            "/product/bin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/su/bin/su",
            "/system/bin/.ext/.su",
            "/vendor/bin/su",
            "/debug_ramdisk/su",
            "/system_ext/bin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/data/local/su"
        )
        // Do not add /data/adb/... (e.g. Magisk or KernelSU binaries there):
        // untrusted_app cannot stat /data/adb due to SELinux policy, so exists() is always false.

        /**
         * Safely quote a single argument for a POSIX shell (`/system/bin/sh -c`).
         * Wraps in single quotes and replaces every single quote with `'\''`.
         */
        fun quoteArg(arg: String): String = "'" + arg.replace("'", "'\\''") + "'"

        /**
         * Quotes an entire argv list and wraps it with cwd directory change.
         */
        fun buildShellCommand(argv: List<String>, cwd: File): String {
            val quotedArgv = argv.joinToString(" ") { quoteArg(it) }
            val quotedCwd = quoteArg(cwd.absolutePath)
            return "cd $quotedCwd && exec $quotedArgv"
        }

        /** `echo "$$ $(cut -d' ' -f22 /proc/$$/stat)" > '<pidFile>' && chmod 0644 '<pidFile>' && cd '<cwd>' && exec 'a' 'b' … */
        fun buildRootCommand(argv: List<String>, cwd: File, pidFile: File): String {
            val quotedPidFile = quoteArg(pidFile.absolutePath)
            val quotedCwd = quoteArg(cwd.absolutePath)
            val quotedArgv = argv.joinToString(" ") { quoteArg(it) }
            return "echo \"\$\$ \$(cut -d' ' -f22 /proc/\$\$/stat)\" > $quotedPidFile && chmod 0644 $quotedPidFile && cd $quotedCwd && exec $quotedArgv"
        }

        /** Same pid line with chmod 0644, then `exec /system/bin/sh -i` (root PTY shell). */
        fun buildRootShell(pidFile: File): String {
            val quotedPidFile = quoteArg(pidFile.absolutePath)
            return "echo \"\$\$ \$(cut -d' ' -f22 /proc/\$\$/stat)\" > $quotedPidFile && chmod 0644 $quotedPidFile && exec /system/bin/sh -i"
        }

        /** Parses "<pid> <starttime>" → RootPid(pid, startTime) or null (missing/garbled/pid<=1). */
        fun parseRootPidFile(text: String): RootPid? {
            val trimmed = text.trim()
            if (trimmed.isEmpty()) return null
            val parts = trimmed.split(Regex("\\s+"))
            if (parts.size != 2) return null
            val pid = parts[0].toIntOrNull() ?: return null
            if (pid <= 1) return null
            val startTime = parts[1].toLongOrNull() ?: return null
            if (startTime < 0L) return null
            return RootPid(pid, startTime)
        }
    }

    /**
     * Resolves the path to the `su` binary without executing it.
     */
    fun findSuBinary(): String? {
        for (candidate in pathCandidates) {
            val file = File(candidate)
            if (runCatching { file.exists() }.getOrDefault(false)) {
                return candidate
            }
        }
        val dirs = pathEnv?.split(":") ?: emptyList()
        for (dir in dirs) {
            if (dir.isBlank()) continue
            val file = File(dir, "su")
            if (runCatching { file.exists() }.getOrDefault(false)) {
                return file.absolutePath
            }
        }
        return null
    }

    fun isAvailable(): Boolean = findSuBinary() != null

    fun isEnabled(): Boolean = isAvailable() && prefs.isEnabled()

    /**
     * Checks if root is currently granted.
     * Makes zero shell calls.
     */
    fun isGranted(): Boolean = isEnabled() && grantCache == true

    fun canUseRoot(): Boolean = isAvailable() && prefs.isEnabled() && grantCache != false

    fun markGranted() {
        grantCache = true
    }

    fun markLost() {
        grantCache = false
    }

    /**
     * Returns current status with zero shell calls in every state.
     */
    fun status(): Status {
        val available = isAvailable()
        if (!available) {
            return Status(available = false, granted = false, enabled = false)
        }
        val enabled = prefs.isEnabled()
        if (!enabled) {
            return Status(available = true, granted = false, enabled = false)
        }
        val granted = grantCache == true
        return Status(available = true, granted = granted, enabled = true)
    }

    /**
     * Requests root access (via explicit user action).
     * Throws [BridgeException] if su is unavailable or request was denied.
     */
    fun requestGrant(timeoutMs: Long = 30_000): Boolean {
        val suPath = findSuBinary()
            ?: throw BridgeException(ErrorCode.E_ROOT_UNAVAILABLE, "root is not available")

        val result = shellRunner.run(listOf(suPath, "-c", "id"), timeoutMs = timeoutMs)
        if (result.exitCode == 0) {
            grantCache = true
            prefs.setEnabled(true)
            return true
        } else {
            grantCache = false
            prefs.setEnabled(false)
            val isTimeout = result.exitCode == -1 && result.stderr.contains("timeout", ignoreCase = true)
            val message = if (isTimeout) {
                "root access timed out"
            } else {
                "root access denied"
            }
            throw BridgeException(ErrorCode.E_ROOT_DENIED, message)
        }
    }

    fun setEnabled(enabled: Boolean) {
        if (enabled && !isAvailable()) {
            throw BridgeException(ErrorCode.E_ROOT_UNAVAILABLE, "root is not available")
        }
        prefs.setEnabled(enabled)
        if (!enabled) {
            grantCache = null
        }
    }

    /**
     * Kills a root process or process group using `su`.
     * Tries killing process group first (-pid), then direct process (pid).
     */
    fun kill(pid: Int, signal: Int): Boolean {
        if (pid <= 0) return false
        val suPath = findSuBinary() ?: return false
        val killCmd = "kill -$signal -$pid 2>/dev/null || kill -$signal $pid 2>/dev/null"
        val result = shellRunner.run(listOf(suPath, "-c", killCmd), timeoutMs = 2_000)
        return result.exitCode == 0
    }

    /** Polls pidFile until parseRootPidFile succeeds or timeoutMs (default 2000) elapses. No su. */
    fun awaitRootPid(pidFile: File, timeoutMs: Long = 2_000, pollMs: Long = 25): RootPid? {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            if (pidFile.exists()) {
                val text = runCatching { pidFile.readText() }.getOrNull()
                if (text != null) {
                    val rootPid = parseRootPidFile(text)
                    if (rootPid != null) return rootPid
                }
            }
            val now = System.currentTimeMillis()
            if (now >= deadline) break
            val sleepTime = minOf(pollMs, deadline - now)
            if (sleepTime <= 0) break
            try {
                Thread.sleep(sleepTime)
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                break
            }
        }
        return null
    }

    /** `su -c "kill -0 <pid> 2>/dev/null && cut -d' ' -f22 /proc/<pid>/stat"` AND the start time still matches. */
    fun isRootPidAlive(rp: RootPid): Boolean {
        if (!canUseRoot()) return false
        if (rp.pid <= 1) return false
        val suPath = findSuBinary() ?: return false

        val checkCmd = "kill -0 ${rp.pid} 2>/dev/null && cut -d' ' -f22 /proc/${rp.pid}/stat"
        val result = shellRunner.run(listOf(suPath, "-c", checkCmd), timeoutMs = 2_000)
        if (result.exitCode != 0) return false

        val currentStartTime = parseStatStartTime(result.stdout) ?: return false
        return currentStartTime == rp.startTime
    }

    private fun parseStatStartTime(text: String): Long? {
        val trimmed = text.trim()
        trimmed.toLongOrNull()?.let { return it }
        val close = trimmed.lastIndexOf(')')
        if (close >= 0 && close + 2 < trimmed.length) {
            val fields = trimmed.substring(close + 2).trim().split(Regex("\\s+"))
            return fields.getOrNull(19)?.toLongOrNull()
        }
        return null
    }
}
