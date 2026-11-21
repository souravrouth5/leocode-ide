package dev.leocode.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Coalesces stream output into one bridge event per name per window.
 *
 * Text is concatenated and raw bytes are concatenated before base64 encoding, so
 * a terminal chunk is never split across messages. The pending buffer is capped;
 * once full, new data is dropped and counted instead of growing without limit.
 */
class EventSink(
    private val post: (event: String, payload: JsonElement) -> Unit,
    private val flushIntervalMs: Long = 16,
    private val maxPendingBytes: Int = 256 * 1024
) {

    private companion object {
        const val FLUSH_BYTES = 32 * 1024

        val scheduler = Executors.newSingleThreadScheduledExecutor { runnable ->
            Thread(runnable, "leocode-eventsink").apply { isDaemon = true }
        }
    }

    private class Pending {
        val text = StringBuilder()
        val bytes = ByteArrayOutputStream()
        var hasBytes = false
    }

    private val lock = Any()
    /** Serialises batches so two flushes cannot post out of order (B-05). */
    private val postLock = Any()
    private val pending = LinkedHashMap<String, Pending>()
    private var pendingBytes = 0
    private var dropped = 0L
    private var timer: ScheduledFuture<*>? = null

    @Volatile
    private var closed = false

    val droppedBytes: Long
        get() = synchronized(lock) { dropped }

    fun text(event: String, text: String) {
        if (text.isEmpty()) return
        append(event, text.toByteArray(Charsets.UTF_8).size) { pending ->
            pending.text.append(text)
        }
    }

    fun bytes(event: String, bytes: ByteArray) {
        if (bytes.isEmpty()) return
        append(event, bytes.size) { pending ->
            pending.hasBytes = true
            pending.bytes.write(bytes)
        }
    }

    fun flush() {
        synchronized(postLock) {
            val messages = ArrayList<Pair<String, JsonElement>>()
            synchronized(lock) {
                timer?.cancel(false)
                timer = null
                for ((event, pending) in this.pending) {
                    if (pending.text.isNotEmpty()) {
                        messages += event to buildJsonObject {
                            put("data", pending.text.toString())
                        }
                    } else if (pending.hasBytes && pending.bytes.size() > 0) {
                        val b64 = Base64.getEncoder().encodeToString(pending.bytes.toByteArray())
                        messages += event to buildJsonObject { put("b64", b64) }
                    }
                }
                this.pending.clear()
                pendingBytes = 0
            }
            for ((event, payload) in messages) {
                runCatching { post(event, payload) }
            }
        }
    }

    fun close() {
        synchronized(lock) { closed = true }
        flush()
    }

    private fun append(event: String, size: Int, write: (Pending) -> Unit) {
        if (closed) return
        var flushNow = false
        synchronized(lock) {
            if (closed) return
            if (pendingBytes + size > maxPendingBytes) {
                dropped += size.toLong()
                return
            }
            val buffer = pending.getOrPut(event) { Pending() }
            write(buffer)
            pendingBytes += size
            if (pendingBytes >= FLUSH_BYTES) {
                flushNow = true
            } else if (timer == null) {
                timer = scheduler.schedule({ flush() }, flushIntervalMs, TimeUnit.MILLISECONDS)
            }
        }
        if (flushNow) flush()
    }
}
