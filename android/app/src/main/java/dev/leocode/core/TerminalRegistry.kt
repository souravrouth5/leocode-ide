package dev.leocode.core

import java.io.File
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Owns live PTY sessions for the app process (Task 10).
 *
 * A session keeps reading while no WebView is attached: output is appended to a
 * bounded [RingBuffer], so backgrounding, renderer loss and Activity recreation
 * lose no recent scrollback. [attach] snapshots that buffer and then streams live
 * data, using the same 256 KB credit window as `term.open` to stop a `yes` flood
 * from overwhelming the WebView.
 *
 * The registry is deliberately free of Android APIs: production uses
 * [PtySession] through the [PtyProcess] interface, tests use a fake.
 */
class TerminalRegistry(
    private val spawn: (
        cwd: String,
        env: Map<String, String>,
        rows: Int,
        cols: Int
    ) -> PtyProcess?,
    private val pidFiles: PidFileStore? = null,
    private val onCountChanged: (Int) -> Unit = {}
) {

    companion object {
        const val DEFAULT_COLS = 80
        const val DEFAULT_ROWS = 24
        const val INITIAL_CREDIT = 256L * 1024
        const val MAX_CREDIT = 4L * 1024 * 1024
        const val SCROLLBACK_BYTES = 256 * 1024

        /** Rows/cols are clamped to something a terminal can represent. */
        const val MAX_DIMENSION = 1000
        /** Exited sessions are kept for reattach, but not without bound. */
        private const val MAX_EXITED = 8

        private const val MAX_READ = 32 * 1024
        private const val MAX_PAUSED_BYTES = 512 * 1024
    }

    data class Opened(val sessionId: String, val pid: Int)

    class Snapshot(
        val sessionId: String,
        val scrollback: ByteArray,
        val alive: Boolean,
        val exitCode: Int
    )

    data class Info(
        val sessionId: String,
        val pid: Int,
        val alive: Boolean,
        val title: String,
        val cwd: String,
        val exitCode: Int
    )

    /** Receives live output after [attach]. */
    interface Listener {
        fun data(bytes: ByteArray)
        fun exit(code: Int)
    }

    /**
     * An attached session. The reply carrying [snapshot] must be sent before
     * [start] so the browser sees the scrollback before the first live event.
     */
    class Attachment(
        val snapshot: Snapshot,
        private val begin: () -> Unit
    ) {
        fun start() = begin()
    }

    private val sessions = ConcurrentHashMap<String, Session>()

    fun open(cwd: File, env: Map<String, String>, rows: Int, cols: Int): Opened? {
        pruneExited()
        val pty = spawn(
            cwd.absolutePath,
            env,
            rows.coerceIn(1, MAX_DIMENSION),
            cols.coerceIn(1, MAX_DIMENSION)
        ) ?: return null

        val id = UUID.randomUUID().toString()
        val session = Session(id, cwd.absolutePath, titleFor(cwd), pty)
        sessions[id] = session
        pidFiles?.write(id, pty.pid, "term")
        thread(isDaemon = true, name = "leocode-term-$id") {
            pump(session)
        }
        notifyCount()
        return Opened(id, pty.pid)
    }

    fun attach(
        sessionId: String,
        listener: Listener,
        credit: Long = INITIAL_CREDIT
    ): Attachment? {
        val session = sessions[sessionId] ?: return null
        return session.attach(listener, credit)
    }

    fun list(): List<Info> = sessions.values.map { session ->
        session.info()
    }

    fun write(sessionId: String, bytes: ByteArray): Boolean =
        sessions[sessionId]?.write(bytes)?.let { it >= 0 } ?: false

    fun resize(sessionId: String, rows: Int, cols: Int): Boolean =
        sessions[sessionId]?.resize(rows, cols) ?: false

    fun ack(sessionId: String, bytes: Long): Boolean =
        sessions[sessionId]?.ack(bytes) ?: false

    fun close(sessionId: String): Boolean {
        val session = sessions.remove(sessionId) ?: return false
        session.close()
        pidFiles?.remove(sessionId)
        notifyCount()
        return true
    }

    /** Stop all sessions (the notification's Stop all action). */
    fun closeAll() {
        var removed = false
        for (id in sessions.keys.toList()) {
            val session = sessions.remove(id) ?: continue
            removed = true
            session.close()
            pidFiles?.remove(id)
        }
        if (removed) notifyCount()
    }

    /**
     * Drop WebView listeners but leave the PTYs running. Called when the Activity
     * or its renderer goes away; a later `term.attach` resumes the stream.
     */
    fun detachAll() {
        sessions.values.forEach { it.detach(null) }
    }

    fun detach(sessionId: String, listener: Listener? = null) {
        sessions[sessionId]?.detach(listener)
    }

    /** Sessions whose PTY is still running; exited ones wait for a reattach. */
    fun activeCount(): Int = sessions.values.count { it.alive }

    private fun notifyCount() {
        runCatching { onCountChanged(sessions.size) }
    }

    private fun pump(session: Session) {
        try {
            while (true) {
                val want = session.reserve(MAX_READ)
                if (want <= 0) break
                val chunk = try {
                    session.read(want)
                } catch (_: Throwable) {
                    null
                }
                if (chunk == null) {
                    session.release(want)
                    break
                }
                if (chunk.isEmpty()) {
                    session.release(want)
                    continue
                }
                val usable = if (chunk.size > want) chunk.copyOf(want) else chunk
                if (usable.size < want) session.release(want - usable.size)
                session.received(usable)
            }
        } finally {
            val code = runCatching { session.pty.waitFor() }.getOrDefault(-1)
            session.finish(code)
            // Close the master fd and signal any background members of the dead
            // shell's group, but keep the ring buffer for a reattach (L-05/L-13).
            runCatching { session.pty.destroy() }
            pidFiles?.remove(session.id)
            notifyCount()
        }
    }

    private fun pruneExited() {
        val exited = sessions.values.filter { !it.alive }.sortedBy { it.finishedAt }
        var excess = exited.size - MAX_EXITED
        for (session in exited) {
            if (excess <= 0) break
            if (sessions.remove(session.id, session)) excess--
        }
    }

    private fun titleFor(cwd: File): String =
        cwd.name.ifBlank { if (cwd.absolutePath == "/") "/" else "workspace" }

    private inner class Session(
        val id: String,
        val cwd: String,
        val title: String,
        val pty: PtyProcess
    ) {
        private val ring = RingBuffer(SCROLLBACK_BYTES)
        private val lock = Object()

        private var listener: Listener? = null
        private var credit = 0L
        private var paused = false
        private val queued = ArrayDeque<ByteArray>()
        private var queuedBytes = 0
        private var pendingExit: Int? = null

        @Volatile
        var alive = true
            private set

        @Volatile
        private var exitCode = -1

        @Volatile
        var finishedAt: Long = 0L
            private set

        fun info(): Info = Info(id, pty.pid, alive, title, cwd, exitCode)

        fun attach(next: Listener, initialCredit: Long): Attachment {
            synchronized(lock) {
                listener = next
                credit = initialCredit.coerceAtLeast(0)
                paused = false
                queued.clear()
                queuedBytes = 0
                pendingExit = null
                val snapshot = Snapshot(id, ring.snapshot(), alive, exitCode)
                if (!alive) {
                    listener = null
                    return Attachment(snapshot) {}
                }
                paused = true
                return Attachment(snapshot) { beginStreaming() }
            }
        }

        private fun beginStreaming() {
            val target: Listener?
            var exit: Int? = null
            synchronized(lock) {
                if (!paused) return
                target = listener
                val chunks = queued.toList()
                // Replay before live data can be delivered: received() takes the
                // same lock and must not overtake the queued chunks (B-11).
                if (target != null) {
                    for (chunk in chunks) runCatching { target.data(chunk) }
                }
                queued.clear()
                queuedBytes = 0
                credit -= chunks.sumOf { it.size.toLong() }
                paused = false
                exit = pendingExit
                pendingExit = null
                lock.notifyAll()
            }
            if (target != null && exit != null) {
                runCatching { target.exit(exit) }
                synchronized(lock) {
                    if (listener === target) listener = null
                }
            }
        }

        fun detach(expected: Listener?) {
            synchronized(lock) {
                if (expected == null || listener === expected) {
                    listener = null
                    paused = false
                    queued.clear()
                    queuedBytes = 0
                    pendingExit = null
                }
                lock.notifyAll()
            }
        }

        /** Blocks while attached, live and out of credit; reads freely otherwise. */
        fun reserve(max: Int): Int {
            synchronized(lock) {
                while (alive && listener != null && !paused && credit <= 0) {
                    try {
                        lock.wait()
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                        return 0
                    }
                }
                if (!alive) return 0
                if (listener == null || paused) return max
                val want = minOf(credit, max.toLong()).toInt()
                credit -= want
                return want
            }
        }

        /** Return reserved-but-unused credit after a short read. */
        fun release(bytes: Int) {
            if (bytes <= 0) return
            synchronized(lock) {
                credit = minOf(MAX_CREDIT, credit + bytes)
            }
        }

        fun received(bytes: ByteArray) {
            synchronized(lock) {
                ring.write(bytes)
                val target = listener
                if (alive && target != null) {
                    if (paused) {
                        if (queuedBytes + bytes.size <= MAX_PAUSED_BYTES) {
                            queued.addLast(bytes)
                            queuedBytes += bytes.size
                        }
                    } else {
                        runCatching { target.data(bytes) }
                    }
                }
            }
        }

        fun read(max: Int): ByteArray? = pty.readBlocking(max)

        /**
         * The blocking PTY write must not hold [lock]: a child that stops
         * reading input would otherwise freeze output, ack, resize and close
         * (B-02/L-04).
         */
        fun write(bytes: ByteArray): Int {
            val target = synchronized(lock) { if (alive) pty else null } ?: return -1
            return target.write(bytes)
        }

        fun resize(rows: Int, cols: Int): Boolean = synchronized(lock) {
            if (!alive) {
                false
            } else {
                pty.resize(rows, cols)
                true
            }
        }

        fun ack(bytes: Long): Boolean {
            if (bytes < 0) return false
            synchronized(lock) {
                if (!alive) return false
                if (bytes == 0L) return true
                credit = minOf(MAX_CREDIT, credit + bytes.coerceAtMost(MAX_CREDIT))
                lock.notifyAll()
                return true
            }
        }

        fun finish(code: Int) {
            val target: Listener?
            val deliver: Boolean
            synchronized(lock) {
                alive = false
                exitCode = code
                finishedAt = System.currentTimeMillis()
                target = listener
                deliver = target != null && !paused
                if (paused) pendingExit = code
                if (deliver) listener = null
                lock.notifyAll()
            }
            if (deliver && target != null) runCatching { target.exit(code) }
        }

        fun close() {
            val wasAlive: Boolean
            synchronized(lock) {
                wasAlive = alive
                alive = false
                listener = null
                paused = false
                queued.clear()
                queuedBytes = 0
                pendingExit = null
                lock.notifyAll()
            }
            if (wasAlive) runCatching { pty.destroy() }
        }
    }
}
