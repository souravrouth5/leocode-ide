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
}

class PtySession private constructor(
    private val descriptor: ParcelFileDescriptor,
    val pid: Int
) {
    companion object {
        /** Opens an interactive `/system/bin/sh -i` in a new session/process group. */
        fun openShell(cwd: String, env: Map<String, String>, rows: Int, cols: Int): PtySession? =
            open("exec /system/bin/sh -i", cwd, env, rows, cols)

        fun open(cmd: String, cwd: String, env: Map<String, String>, rows: Int, cols: Int): PtySession? {
            if (!NativePty.available()) return null
            val pairs = env.map { (k, v) -> "$k=$v" }.toTypedArray()
            val result = NativePty.createSubprocess(cmd, cwd, pairs, rows, cols)
            if (result.size < 2 || result[0] <= 0 || result[1] < 0) return null
            val descriptor = try {
                ParcelFileDescriptor.adoptFd(result[1])
            } catch (e: Throwable) {
                return null
            }
            return PtySession(descriptor, result[0])
        }
    }

    private val fd: FileDescriptor = descriptor.fileDescriptor

    fun write(bytes: ByteArray): Int = try {
        Os.write(fd, bytes, 0, bytes.size)
    } catch (e: ErrnoException) {
        -1
    }

    /**
     * Blocking single read. Returns null on EOF/EIO (which is what a PTY master
     * reports when the child exits). Intended for a dedicated reader thread.
     */
    fun readBlocking(maxBytes: Int = 16 * 1024): ByteArray? {
        if (maxBytes <= 0) return null
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
            val chunk = readBlocking() ?: break
            out.write(chunk)
        }
        return out.toString("UTF-8")
    }

    fun resize(rows: Int, cols: Int) {
        NativePty.setWindowSize(descriptor.fd, rows, cols)
    }

    fun waitFor(): Int = NativePty.waitFor(pid)

    fun destroy() {
        // Kill the group first: that closes the slave side and unblocks any reader.
        NativePty.killGroup(pid, OsConstants.SIGTERM)
        NativePty.killGroup(pid, OsConstants.SIGKILL)
        runCatching { descriptor.close() }
    }
}
