package dev.leocode.bridge

/**
 * Drops repeated progress events that arrive inside a short window (PD-05).
 *
 * `saf.progress` used to post one WebView message per imported file (up to
 * 20 000) and per restore entry, which floods the page's message queue. The
 * sink forwards the first event and then at most one event per
 * [windowMs] for the same name; the payload of the dropped events is not
 * merged, because the next event carries the cumulative file/byte counters.
 *
 * Search events are deliberately not throttled here: `search.match` is
 * batched by the other branch and a dropped match would be lost data.
 *
 * Thread-safe: the streaming handlers emit from bridge worker threads
 * (`leocode-saf-import`, `leocode-saf-restore`), so [allow] synchronises on its
 * own state. The clock is injectable for tests.
 */
class EventThrottle(
    private val windowMs: Long = DEFAULT_WINDOW_MS,
    private val clock: () -> Long = { System.currentTimeMillis() }
) {

    companion object {
        /** Minimum gap between two forwarded events of the same name. */
        const val DEFAULT_WINDOW_MS = 100L

        /**
         * Which event names this throttle covers. Only progress-style names are
         * throttled; matches, errors and terminal output must never be dropped.
         */
        fun isProgressEvent(name: String): Boolean = name.endsWith(".progress")
    }

    private val lock = Any()
    private val lastForwarded = HashMap<String, Long>()

    /**
     * Records the event and returns true when it may be forwarded. The first
     * event for a name always passes; later ones are dropped until [windowMs]
     * has elapsed since the last forwarded event of that name.
     */
    fun allow(name: String): Boolean {
        synchronized(lock) {
            val now = clock()
            val previous = lastForwarded[name]
            if (previous != null) {
                val elapsed = now - previous
                // Only a forward-moving clock can prove the window has elapsed.
                // A backwards jump (NTP, user change) is treated as "the window
                // passed"; suppressing progress until the clock catches up would
                // freeze the dialog for the length of the jump.
                if (elapsed >= 0 && elapsed < windowMs) return false
            }
            lastForwarded[name] = now
            return true
        }
    }

    /** Forgets the history; used when a stream starts over. */
    fun reset() {
        synchronized(lock) { lastForwarded.clear() }
    }
}
