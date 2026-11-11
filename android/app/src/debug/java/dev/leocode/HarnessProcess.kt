package dev.leocode

import dev.leocode.core.ProcessSupervisor
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Blocking adapter over [ProcessSupervisor] for the Phase 0B harness (debug only).
 *
 * The production path is event-based; the harness wants one synchronous result per
 * test, so this waits for `onExit` and returns everything that was captured.
 */
internal object HarnessProcess {

    data class Result(
        val pid: Int,
        val exitCode: Int,
        val stdout: String,
        val stderr: String,
        val durationMs: Long,
        /** The supervisor reports a timeout as exit code -1. */
        val timedOut: Boolean,
        /** Stdout reached the per-stream cap, so later output was discarded. */
        val stdoutTruncated: Boolean
    )

    fun run(supervisor: ProcessSupervisor, spec: ProcessSupervisor.Spec): Result {
        val stdout = StringBuilder()
        val stderr = StringBuilder()
        val done = CountDownLatch(1)
        var exit = -2
        val started = System.currentTimeMillis()

        val handle = supervisor.start(
            spec,
            onStdout = { synchronized(stdout) { stdout.append(it) } },
            onStderr = { synchronized(stderr) { stderr.append(it) } },
            onExit = { code ->
                exit = code
                done.countDown()
            }
        )

        // The supervisor always reports exit once its own timeout has run out, so this
        // wait only bounds a supervisor bug; it is not a second timeout.
        val finished = done.await(spec.timeoutMs + 15_000, TimeUnit.MILLISECONDS)
        if (!finished) supervisor.cancel(handle.jobId)
        val out = synchronized(stdout) { stdout.toString() }
        val err = synchronized(stderr) { stderr.toString() }
        return Result(
            pid = handle.pid,
            exitCode = if (finished) exit else -2,
            stdout = out,
            stderr = err,
            durationMs = System.currentTimeMillis() - started,
            timedOut = exit == -1,
            stdoutTruncated = out.toByteArray(Charsets.UTF_8).size >= spec.maxOutputBytes
        )
    }
}
