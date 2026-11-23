package dev.leocode.core

import dev.leocode.bridge.BridgeException
import dev.leocode.bridge.ErrorCode
import java.io.File
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

    interface RootPrefs {
        fun isEnabled(): Boolean
        fun setEnabled(enabled: Boolean)
    }

    interface ShellRunner {
        fun run(command: List<String>, timeoutMs: Long = 10_000): ShellResult
    }

    data class ShellResult(val exitCode: Int, val stdout: String, val stderr: String)

    class ProcessShellRunner : ShellRunner {
        override fun run(command: List<String>, timeoutMs: Long): ShellResult {
            return try {
                val process = ProcessBuilder(command).start()
                val stdout = process.inputStream.bufferedReader().use { it.readText() }
                val stderr = process.errorStream.bufferedReader().use { it.readText() }
                val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
                if (!finished) {
                    process.destroyForcibly()
                    ShellResult(-1, stdout, "timeout after ${timeoutMs}ms")
                } else {
                    ShellResult(process.exitValue(), stdout, stderr)
                }
            } catch (e: Exception) {
                ShellResult(-1, "", e.message ?: "execution failed")
            }
        }
    }

    data class Status(
        val available: Boolean,
        val granted: Boolean,
        val enabled: Boolean
    )

    companion object {
        val DEFAULT_SU_PATHS = listOf(
            "/product/bin/su",
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/su/bin/su",
            "/system/bin/.ext/.su",
            "/vendor/bin/su",
            "/data/local/xbin/su",
            "/data/local/bin/su",
            "/data/local/su"
        )

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
     * When not enabled, returns false immediately without executing `su`.
     */
    fun isGranted(): Boolean {
        if (!isEnabled()) return false
        val suPath = findSuBinary() ?: return false
        val result = shellRunner.run(listOf(suPath, "-c", "id"), timeoutMs = 3_000)
        return result.exitCode == 0
    }

    fun status(): Status {
        val available = isAvailable()
        if (!available) {
            return Status(available = false, granted = false, enabled = false)
        }
        val enabled = prefs.isEnabled()
        if (!enabled) {
            return Status(available = true, granted = false, enabled = false)
        }
        val granted = isGranted()
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
            prefs.setEnabled(true)
            return true
        } else {
            prefs.setEnabled(false)
            throw BridgeException(ErrorCode.E_ROOT_DENIED, "root access denied")
        }
    }

    fun setEnabled(enabled: Boolean) {
        if (enabled && !isAvailable()) {
            throw BridgeException(ErrorCode.E_ROOT_UNAVAILABLE, "root is not available")
        }
        prefs.setEnabled(enabled)
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
}
