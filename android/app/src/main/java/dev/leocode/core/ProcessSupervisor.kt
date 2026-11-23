package dev.leocode.core

import java.io.InputStream
import java.io.InputStreamReader
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * Owns `proc.run` children (Task 6).
 *
 * - Output is decoded as UTF-8 and capped at [Spec.maxOutputBytes] per stream.
 * - A timeout emits `exit(-1)`; cancellation is SIGTERM, up to 2 s, then SIGKILL.
 * - `onExit` runs exactly once, after both pumps have finished.
 * - No Android APIs on the JVM test path: `NativePty.available()` is false there
 *   and the fallback uses only [Process.destroy].
 */
class ProcessSupervisor(
    private val childEnv: Map<String, String> = emptyMap(),
    private val pidFiles: PidFileStore? = null,
    private val onCountChanged: (Int) -> Unit = {},
    private val rootManager: RootManager? = null
) {

    data class Spec(
        val argv: List<String>,
        val cwd: java.io.File,
        val env: Map<String, String> = emptyMap(),
        val timeoutMs: Long = 30_000,
        val maxOutputBytes: Int = 1 shl 20,
        val root: Boolean = false
    )

    data class Handle(val jobId: String, val pid: Int)

    private class Job(
        val id: String,
        val process: Process,
        val pid: Int,
        val root: Boolean = false,
        val terminating: AtomicBoolean = AtomicBoolean(false),
        val exitOnce: AtomicBoolean = AtomicBoolean(false)
    )

    private val jobs = ConcurrentHashMap<String, Job>()

    fun start(
        spec: Spec,
        onStdout: (String) -> Unit,
        onStderr: (String) -> Unit,
        onExit: (Int) -> Unit
    ): Handle {
        require(spec.argv.isNotEmpty()) { "argv is empty" }

        val command = if (spec.root) {
            val suPath = rootManager?.findSuBinary() ?: "su"
            val shellCmd = RootManager.buildShellCommand(spec.argv, spec.cwd)
            listOf(suPath, "-c", shellCmd)
        } else if (SETSID.canExecute()) {
            listOf(SETSID.path) + spec.argv
        } else {
            spec.argv
        }

        val builder = ProcessBuilder(command)
            .directory(spec.cwd)
            .redirectErrorStream(false)
        val environment = builder.environment()
        environment.clear()
        environment.putAll(ChildEnv.build(childEnv, spec.env))
        // The child's working directory is authoritative; Workspace.childEnv()
        // only knows the default workspace.
        environment["PWD"] = spec.cwd.absolutePath

        val process = builder.start()
        // Close the child's stdin at once: `cat`, `python -` and `input()` used
        // to block forever on an open pipe (B-07).
        runCatching { process.outputStream.close() }
        val pid = pidOf(process)
        val jobId = UUID.randomUUID().toString()
        val job = Job(jobId, process, pid, root = spec.root)
        jobs[jobId] = job
        // A pidfile failure must not leave a running process without pumps (B-21).
        runCatching { pidFiles?.write(jobId, pid, if (spec.root) "root-proc" else "proc") }
        notifyCount()

        val outPump = StreamPump(process.inputStream, spec.maxOutputBytes, onStdout)
        val errPump = StreamPump(process.errorStream, spec.maxOutputBytes, onStderr)
        val outThread = thread(isDaemon = true, name = "leocode-proc-out-$jobId") {
            outPump.run()
        }
        val errThread = thread(isDaemon = true, name = "leocode-proc-err-$jobId") {
            errPump.run()
        }

        thread(isDaemon = true, name = "leocode-proc-wait-$jobId") {
            var timedOut = false
            try {
                if (spec.timeoutMs > 0) {
                    val finished = process.waitFor(spec.timeoutMs, TimeUnit.MILLISECONDS)
                    if (!finished) {
                        timedOut = true
                        terminate(job)
                    }
                } else {
                    process.waitFor()
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } catch (_: Throwable) {
                timedOut = true
            }

            joinQuietly(outThread)
            joinQuietly(errThread)
            jobs.remove(jobId)
            pidFiles?.remove(jobId)
            notifyCount()
            val code = if (timedOut) -1 else runCatching { process.exitValue() }.getOrDefault(-1)
            finish(job, code, onExit)
        }

        return Handle(jobId, pid)
    }

    /** SIGTERM the group, wait up to 2 s, then SIGKILL. */
    fun cancel(jobId: String): Boolean {
        val job = jobs[jobId] ?: return false
        terminate(job)
        return true
    }

    fun close() {
        jobs.keys.toList().forEach { id ->
            jobs[id]?.let { terminate(it) }
        }
    }

    fun activeCount(): Int = jobs.size

    private fun notifyCount() {
        runCatching { onCountChanged(jobs.size) }
    }

    private fun terminate(job: Job) {
        if (!job.terminating.compareAndSet(false, true)) return

        val native = job.pid > 0 && NativePty.available()
        if (job.root) {
            rootManager?.kill(job.pid, 15)
        } else if (native) {
            NativePty.killGroup(job.pid, 15)
        } else {
            runCatching { job.process.destroy() }
        }

        val exited = runCatching { job.process.waitFor(2, TimeUnit.SECONDS) }.getOrDefault(false)
        if (!exited) {
            if (job.root) {
                rootManager?.kill(job.pid, 9)
            } else if (native) {
                NativePty.killGroup(job.pid, 9)
            }
            runCatching { job.process.destroyForcibly() }
        }
    }

    private fun finish(job: Job, code: Int, onExit: (Int) -> Unit) {
        if (job.exitOnce.compareAndSet(false, true)) {
            runCatching { onExit(code) }
        }
    }

    private fun joinQuietly(t: Thread) {
        runCatching { t.join(2_000) }
    }

    /**
     * The child pid for signal delivery and pidfiles.
     *
     * Android's `Process` exposes the pid only through its `pid` field (the public
     * `Process.pid()` method appears in API 33). Desktop JVMs hide that field
     * behind module encapsulation but do have `pid()`, so both are tried.
     */
    private fun pidOf(process: Process): Int {
        runCatching {
            val field = process.javaClass.getDeclaredField("pid")
            field.isAccessible = true
            return field.getInt(process)
        }
        return runCatching {
            val method = Process::class.java.getMethod("pid")
            (method.invoke(process) as Number).toInt()
        }.getOrDefault(-1)
    }

    /** Decodes one stream without splitting a multi-byte character across events. */
    private class StreamPump(
        private val stream: InputStream,
        private val cap: Int,
        private val emit: (String) -> Unit
    ) {
        private var total = 0
        private var truncated = false

        fun run() {
            val reader = InputStreamReader(stream, Charsets.UTF_8)
            val chars = CharArray(8 * 1024)
            try {
                while (true) {
                    val read = try {
                        reader.read(chars)
                    } catch (_: Throwable) {
                        break
                    }
                    if (read < 0) break
                    if (read == 0) continue

                    val text = String(chars, 0, read)
                    if (truncated) continue

                    val size = text.toByteArray(Charsets.UTF_8).size
                    val chunk = if (total + size <= cap) {
                        text
                    } else {
                        truncated = true
                        utf8Prefix(text, (cap - total).coerceAtLeast(0))
                    }
                    if (chunk.isEmpty()) continue
                    total += chunk.toByteArray(Charsets.UTF_8).size
                    runCatching { emit(chunk) }
                }
            } finally {
                if (truncated) {
                    // Tell the UI why the stream went quiet instead of dropping
                    // the rest silently (B-08).
                    runCatching { emit("\n[output truncated at $cap bytes]\n") }
                }
                runCatching { reader.close() }
            }
        }

        /** Longest char-boundary prefix of [text] whose UTF-8 form fits in [maxBytes]. */
        private fun utf8Prefix(text: String, maxBytes: Int): String {
            if (maxBytes <= 0) return ""
            var bytes = 0
            var index = 0
            while (index < text.length) {
                val codePoint = text.codePointAt(index)
                val size = when {
                    codePoint <= 0x7F -> 1
                    codePoint <= 0x7FF -> 2
                    codePoint <= 0xFFFF -> 3
                    else -> 4
                }
                if (bytes + size > maxBytes) break
                bytes += size
                index += Character.charCount(codePoint)
            }
            return text.substring(0, index)
        }
    }

    private companion object {
        val SETSID = java.io.File("/system/bin/setsid")
    }
}
