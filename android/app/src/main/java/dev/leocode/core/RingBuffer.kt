package dev.leocode.core

/**
 * Bounded byte buffer that keeps the newest [capacity] bytes and drops the
 * oldest data when it overflows (Task 10).
 *
 * Terminal output is kept here so a WebView that is recreated (renderer loss,
 * Activity recreation) can replay its scrollback. Chunks are stored by reference
 * and partially trimmed at the head, so a chatty `yes` does not copy the whole
 * buffer on every write.
 */
class RingBuffer(private val capacity: Int) {

    init {
        require(capacity > 0) { "capacity must be positive" }
    }

    private class Chunk(val data: ByteArray, var offset: Int, var length: Int)

    private val chunks = ArrayDeque<Chunk>()
    private var total = 0
    /** True once any byte at the head was dropped; snapshots then start mid-stream. */
    private var truncated = false

    /** Number of bytes currently buffered. */
    @Synchronized
    fun size(): Int = total

    @Synchronized
    fun clear() {
        chunks.clear()
        total = 0
    }

    @Synchronized
    fun write(bytes: ByteArray) {
        if (bytes.isEmpty()) return

        // A single write larger than the whole buffer can only keep its tail.
        val incoming = if (bytes.size <= capacity) {
            bytes.copyOf()
        } else {
            bytes.copyOfRange(bytes.size - capacity, bytes.size)
        }
        if (incoming.size >= capacity) {
            chunks.clear()
            total = 0
            truncated = true
        }

        chunks.addLast(Chunk(incoming, 0, incoming.size))
        total += incoming.size

        while (total > capacity) {
            val head = chunks.first()
            val drop = total - capacity
            if (head.length <= drop) {
                chunks.removeFirst()
                total -= head.length
            } else {
                head.offset += drop
                head.length -= drop
                total -= drop
            }
            truncated = true
        }
    }

    /** Copy of the buffered bytes, oldest first. */
    @Synchronized
    fun snapshot(): ByteArray {
        val out = ByteArray(total)
        var position = 0
        for (chunk in chunks) {
            System.arraycopy(chunk.data, chunk.offset, out, position, chunk.length)
            position += chunk.length
        }
        return out
    }

    /**
     * Replay view for `term.attach`: if the head was trimmed, start at the next
     * complete line and reset SGR state, so a replay cannot begin in the middle
     * of an escape sequence (L-22). An untrimmed buffer is returned unchanged.
     */
    @Synchronized
    fun snapshotAligned(): ByteArray {
        val raw = snapshot()
        if (!truncated || raw.isEmpty()) return raw
        val newline = raw.indexOf(NEWLINE)
        if (newline < 0 || newline + 1 >= raw.size) return raw
        val body = raw.copyOfRange(newline + 1, raw.size)
        val reset = "\u001b[0m".toByteArray(Charsets.US_ASCII)
        val out = ByteArray(reset.size + body.size)
        System.arraycopy(reset, 0, out, 0, reset.size)
        System.arraycopy(body, 0, out, reset.size, body.size)
        return out
    }

    private companion object {
        const val NEWLINE = 10.toByte()
    }
}
