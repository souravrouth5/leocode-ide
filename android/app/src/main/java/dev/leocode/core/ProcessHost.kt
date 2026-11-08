package dev.leocode.core

import android.os.Process as AndroidProcess
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

/**
 * Phase 0B process execution.
 *
 * - Output is captured with a hard byte cap, so `yes` cannot OOM the app.
 * - Timeout and cancellation kill the process group when the caller launched it
 *   through `setsid` (or through the native PTY layer, which setsids itself).
 * - No shell interpolation: callers pass argv explicitly.
 */
class ProcessHost(private val env: Map<String, String> = emptyMap()) {

    data class Spec(
        val argv: List<String>,
        val cwd: File,
        val timeoutMs: Long = 30_000,
        val maxOutputBytes: Int = 1 shl 20,
        val env: Map<String, String> = emptyMap()
    )

    data class Result(
        val pid: Int,
        val exitCode: Int,
        val stdout: String,
        val stderr: String,
        val timedOut: Boolean,
        val stdoutTruncated: Boolean,
        val stderrTruncated: Boolean,
        val durationMs: Long
    )

    fun run(spec: Spec): Result {
        require(spec.argv.isNotEmpty()) { "argv is empty" }
        val started = System.currentTimeMillis()

        val pb = ProcessBuilder(spec.argv)
            .directory(spec.cwd)
            .redirectErrorStream(false)

        val pbEnv = pb.environment()
        pbEnv.clear()
        pbEnv.putAll(env)
        pbEnv.putAll(spec.env)

        val process = pb.start()
        val pid = pidOf(process)

        val out = Collector(spec.maxOutputBytes)
        val err = Collector(spec.maxOutputBytes)

        val t1 = thread(name = "proc-out-$pid", isDaemon = true) {
            out.pump(process.inputStream)
        }
        val t2 = thread(name = "proc-err-$pid", isDaemon = true) {
            err.pump(process.errorStream)
        }

        var timedOut = false
        val finished = process.waitFor(spec.timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished) {
            timedOut = true
            killTree(pid, process)
        }

        t1.join(2_000)
        t2.join(2_000)

        val exit = runCatching { process.exitValue() }.getOrDefault(-1)
        return Result(
            pid = pid,
            exitCode = exit,
            stdout = out.text(),
            stderr = err.text(),
            timedOut = timedOut,
            stdoutTruncated = out.truncated,
            stderrTruncated = err.truncated,
            durationMs = System.currentTimeMillis() - started
        )
    }

    /** Kill the whole process group if possible, then the process itself. */
    fun killTree(pid: Int, process: Process? = null) {
        if (pid > 0 && NativePty.available()) {
            NativePty.killGroup(pid, 15) // SIGTERM
            Thread.sleep(200)
            NativePty.killGroup(pid, 9)  // SIGKILL
        } else if (pid > 0) {
            runCatching { AndroidProcess.sendSignal(pid, 15) }
            Thread.sleep(150)
            runCatching { AndroidProcess.sendSignal(pid, 9) }
        }
        process?.let {
            runCatching { it.destroy() }
            runCatching { it.destroyForcibly() }
        }
    }

    /**
     * android's java.lang.Process does not expose pid() (Java 9 API). The libcore
     * implementation keeps an int field named "pid"; read it reflectively.
     */
    fun pidOf(process: Process): Int = try {
        val field = process.javaClass.getDeclaredField("pid")
        field.isAccessible = true
        field.getInt(process)
    } catch (_: Throwable) {
        -1
    }

    private class Collector(private val cap: Int) {
        private val buffer = ByteArrayOutputStream(minOf(cap, 64 * 1024))
        @Volatile var truncated = false

        fun pump(input: java.io.InputStream) {
            val chunk = ByteArray(16 * 1024)
            try {
                while (true) {
                    val n = input.read(chunk)
                    if (n < 0) break
                    synchronized(this) {
                        val room = cap - buffer.size()
                        if (room <= 0) {
                            truncated = true
                        } else {
                            buffer.write(chunk, 0, minOf(n, room))
                            if (n > room) truncated = true
                        }
                    }
                }
            } catch (_: Throwable) {
                // stream closed by kill
            }
        }

        @Synchronized fun text(): String = buffer.toString("UTF-8")
    }
}
