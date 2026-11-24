package dev.leocode.core

import android.os.ParcelFileDescriptor
import android.system.ErrnoException
import android.system.Os
import android.system.OsConstants
import java.io.ByteArrayOutputStream
import java.io.FileDescriptor

/**
 * JNI PTY layer (D-004).
 *
 * The native side creates a pseudo-terminal, forks, calls setsid() so the child is
 * its own process-group leader, and execs /system/bin/sh -c <cmd>. That makes
 * `kill(-pid, sig)` able to terminate the whole tree, which plain
 * Process.destroy() cannot do on Android.
 *
 * JNI names must match app/src/main/cpp/pty.c.
 */
object NativePty {

    @Volatile private var loaded: Boolean? = null

    fun available(): Boolean {
        loaded?.let { return it }
        synchronized(this) {
            loaded?.let { return it }
            val ok = try {
                System.loadLibrary("leocodepty")
                true
            } catch (t: Throwable) {
                false
            }
            loaded = ok
            return ok
        }
    }

    external fun createSubprocess(
        shellCmd: String,
        cwd: String,
        envPairs: Array<String>,
        rows: Int,
        cols: Int
    ): IntArray

    external fun setWindowSize(fd: Int, rows: Int, cols: Int): Int
    external fun waitFor(pid: Int): Int
    external fun killGroup(pid: Int, signal: Int): Int
    external fun pageSize(): Int

    /** Harness T8: child has exactly the supplied environment (execve envp). */
    external fun probeEnvironment(envPairs: Array<String>): String

    /** Harness T9: child reports how many fds above stderr survived setup. */
    external fun probeFds(envPairs: Array<String>): String
}

/**
 * The small surface [TerminalRegistry] needs from a PTY. Keeping it an interface
 * lets the registry's attach/scrollback logic run on the JVM with a fake process
 * (Task 10 tests).
 */
interface PtyProcess {
    val pid: Int
    val isClosed: Boolean
    fun write(bytes: ByteArray): Int
    fun readBlocking(maxBytes: Int = 16 * 1024): ByteArray?
    fun resize(rows: Int, cols: Int)
    fun waitFor(): Int
    fun destroy()
}

class PtySession private constructor(
    private val descriptor: ParcelFileDescriptor,
    override val pid: Int,
    val isRoot: Boolean = false,
    private val onKillRoot: ((pid: Int, signal: Int) -> Unit)? = null,
    private val isRootPidAlive: ((pid: Int, startTime: Long) -> Boolean)? = null
) : PtyProcess {
    data class RootPid(val pid: Int, val startTime: Long)

    @Volatile
    var rootPid: RootPid? = null

    companion object {
        private const val DESTROY_GRACE_MS = 1_500L
        private const val DESTROY_POLL_MS = 25L
        private const val DESTROY_ROOT_GRACE_MS = 2_000L
        private const val DESTROY_ROOT_POLL_MS = 200L

        /** Opens an interactive `/system/bin/sh -i` or root shell in a new session/process group. */
        fun openShell(
            cwd: String,
            env: Map<String, String>,
            rows: Int,
            cols: Int,
            root: Boolean = false,
            suPath: String? = null,
            rootCommand: String? = null,
            awaitRootPid: (() -> RootPid?)? = null,
            onKillRoot: ((pid: Int, signal: Int) -> Unit)? = null,
            isRootPidAlive: ((pid: Int, startTime: Long) -> Boolean)? = null
        ): PtySession? {
            val cmd = if (root) {
                rootCommand ?: "exec ${suPath ?: "/product/bin/su"}"
            } else {
                "exec /system/bin/sh -i"
            }
            val session = open(
                cmd,
                cwd,
                env,
                rows,
                cols,
                isRoot = root,
                onKillRoot = onKillRoot,
                isRootPidAlive = isRootPidAlive
            ) ?: return null

            if (root && awaitRootPid != null) {
                kotlin.concurrent.thread(isDaemon = true, name = "leocode-pty-rootpid-${session.pid}") {
                    val rp = awaitRootPid()
                    if (rp != null) {
                        session.rootPid = rp
                    }
                }
            }
            return session
        }

        fun open(
            cmd: String,
            cwd: String,
            env: Map<String, String>,
            rows: Int,
            cols: Int,
            isRoot: Boolean = false,
            onKillRoot: ((pid: Int, signal: Int) -> Unit)? = null,
            isRootPidAlive: ((pid: Int, startTime: Long) -> Boolean)? = null
        ): PtySession? {
            if (!NativePty.available()) return null
            val pairs = env.map { (k, v) -> "$k=$v" }.toTypedArray()
            val result = NativePty.createSubprocess(cmd, cwd, pairs, rows, cols)
            if (result.size < 2 || result[0] <= 0 || result[1] < 0) return null
            val descriptor = try {
                ParcelFileDescriptor.adoptFd(result[1])
            } catch (e: Throwable) {
                return null
            }
            return PtySession(
                descriptor,
                result[0],
                isRoot = isRoot,
                onKillRoot = onKillRoot,
                isRootPidAlive = isRootPidAlive
            )
        }
    }

    private val fd: FileDescriptor = descriptor.fileDescriptor

    /** Set by [destroy]; write/resize/read become no-ops afterwards (Task 9). */
    @Volatile
    private var closed = false

    override val isClosed: Boolean get() = closed

    override fun write(bytes: ByteArray): Int {
        if (closed) return -1
        if (bytes.isEmpty()) return 0
        return try {
            Os.write(fd, bytes, 0, bytes.size)
        } catch (e: ErrnoException) {
            -1
        }
    }

    /**
     * Blocking single read. Returns null on EOF/EIO (which is what a PTY master
     * reports when the child exits) or after [destroy]. Intended for a dedicated
     * reader thread.
     */
    override fun readBlocking(maxBytes: Int): ByteArray? {
        if (closed || maxBytes <= 0) return null
        val buf = ByteArray(maxBytes)
        val n = try {
            Os.read(fd, buf, 0, maxBytes)
        } catch (e: ErrnoException) {
            return null
        }
        if (n <= 0) return null
        return if (n == maxBytes) buf else buf.copyOf(n)
    }

    /**
     * Read until EOF/EIO or [timeoutMs]. Os.read() blocks, so the timeout is a soft
     * bound checked between reads. Kept for the Phase 0 smoke test.
     */
    fun read(timeoutMs: Long, maxBytes: Int = 256 * 1024): String {
        val out = ByteArrayOutputStream()
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline && out.size() < maxBytes) {
            val chunk = readBlocking(16 * 1024) ?: break
            out.write(chunk)
        }
        return out.toString("UTF-8")
    }

    override fun resize(rows: Int, cols: Int) {
        if (closed) return
        // The fd can be closed between the flag check and the ioctl (L-18).
        runCatching { NativePty.setWindowSize(descriptor.fd, rows, cols) }
    }

    override fun waitFor(): Int = NativePty.waitFor(pid)

    override fun destroy() {
        if (closed) return
        closed = true
        // SIGTERM first, then a short grace period; SIGKILL only for a child that
        // ignores it (L-17). Called on the pump thread after waitFor() the pid is
        // already gone, so this normally returns immediately.
        if (isRoot) {
            val rp = rootPid
            if (rp != null) {
                onKillRoot?.invoke(rp.pid, OsConstants.SIGTERM)
                var waited = 0L
                while (waited < DESTROY_ROOT_GRACE_MS && isRootPidAlive?.invoke(rp.pid, rp.startTime) == true) {
                    try {
                        Thread.sleep(DESTROY_ROOT_POLL_MS)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        break
                    }
                    waited += DESTROY_ROOT_POLL_MS
                }
                if (isRootPidAlive?.invoke(rp.pid, rp.startTime) == true) {
                    onKillRoot?.invoke(rp.pid, OsConstants.SIGKILL)
                }
            } else {
                runCatching {
                    android.util.Log.w("LeoCodePty", "Root pid unknown for pty session; falling back to client kill")
                }
                onKillRoot?.invoke(pid, OsConstants.SIGTERM)
                var waited = 0L
                while (waited < DESTROY_GRACE_MS && ProcessStartTime.read(pid) != null) {
                    try {
                        Thread.sleep(DESTROY_POLL_MS)
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        break
                    }
                    waited += DESTROY_POLL_MS
                }
                if (ProcessStartTime.read(pid) != null) {
                    onKillRoot?.invoke(pid, OsConstants.SIGKILL)
                }
            }
        } else {
            NativePty.killGroup(pid, OsConstants.SIGTERM)
            var waited = 0L
            while (waited < DESTROY_GRACE_MS && ProcessStartTime.read(pid) != null) {
                try {
                    Thread.sleep(DESTROY_POLL_MS)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
                waited += DESTROY_POLL_MS
            }
            if (ProcessStartTime.read(pid) != null) {
                NativePty.killGroup(pid, OsConstants.SIGKILL)
            }
        }
        runCatching { descriptor.close() }
    }
}
