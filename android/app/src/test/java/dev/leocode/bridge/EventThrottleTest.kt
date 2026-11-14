package dev.leocode.bridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class EventThrottleTest {

    private var now = 1_000L
    private val throttle = EventThrottle(windowMs = 100L) { now }

    @Test
    fun `the first event of a name is forwarded`() {
        assertTrue(throttle.allow("saf.progress"))
    }

    @Test
    fun `a second event inside the window is dropped`() {
        assertTrue(throttle.allow("saf.progress"))

        now += 99
        assertFalse(throttle.allow("saf.progress"))
    }

    @Test
    fun `an event exactly at the window is forwarded`() {
        assertTrue(throttle.allow("saf.progress"))

        now += 100
        assertTrue(throttle.allow("saf.progress"))
    }

    @Test
    fun `an event after the window is forwarded`() {
        assertTrue(throttle.allow("saf.progress"))

        now += 60_000
        assertTrue(throttle.allow("saf.progress"))
    }

    @Test
    fun `different names are throttled independently`() {
        assertTrue(throttle.allow("saf.progress"))

        now += 10
        assertTrue(throttle.allow("saf.export.progress"))
        assertTrue(throttle.allow("search.match"))
    }

    @Test
    fun `a backwards clock does not lock the stream`() {
        assertTrue(throttle.allow("saf.progress"))

        now -= 5
        // Wall-clock time can jump backwards (NTP, user change). Suppressing
        // progress until the clock catches up would freeze the dialog, so the
        // backwards jump counts as "the window passed".
        assertTrue(throttle.allow("saf.progress"))
    }

    @Test
    fun `only progress event names are throttled`() {
        assertTrue(EventThrottle.isProgressEvent("saf.progress"))
        assertTrue(EventThrottle.isProgressEvent("saf.export.progress"))
        assertFalse(EventThrottle.isProgressEvent("search.match"))
        assertFalse(EventThrottle.isProgressEvent("search.summary"))
        assertFalse(EventThrottle.isProgressEvent("saf.progressed"))
    }

    @Test
    fun `reset forgets the history`() {
        assertTrue(throttle.allow("saf.progress"))
        assertFalse(throttle.allow("saf.progress"))

        throttle.reset()
        assertTrue(throttle.allow("saf.progress"))
    }

    @Test
    fun `concurrent calls forward each name exactly once`() {
        val window = EventThrottle(windowMs = 100L) { now }
        val names = listOf("saf.progress", "saf.export.progress", "saf.restore.progress", "search.match")
        val forwarded = names.map { AtomicInteger(0) }
        val threads = 8
        val callsPerThread = 200
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(threads)
        try {
            repeat(threads) {
                pool.execute {
                    start.await()
                    repeat(callsPerThread) {
                        names.forEachIndexed { index, name ->
                            if (window.allow(name)) forwarded[index].incrementAndGet()
                        }
                    }
                }
            }
            start.countDown()
            pool.shutdown()
            assertTrue("workers did not finish", pool.awaitTermination(10, TimeUnit.SECONDS))
        } finally {
            pool.shutdownNow()
        }

        // The clock never moves, so every name is forwarded once and dropped after.
        names.forEachIndexed { index, name ->
            assertEquals("$name forwarded more than once", 1, forwarded[index].get())
        }
    }
}
