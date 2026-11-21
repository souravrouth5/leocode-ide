package dev.leocode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * L-09: the "two renderer losses in 60 s" rule and the background decision.
 *
 * Both are pure Kotlin so they can be tested without an Activity; [LeoApp]
 * backs the store with SharedPreferences, this test with a mutable field that
 * survives "recreation" the same way.
 */
class RendererLossTest {

    private class Store(var value: Long = 0L)

    private fun tracker(
        store: Store,
        now: Long,
        window: Long = 60_000L
    ) = RendererLossTracker(
        windowMs = window,
        clock = { now },
        read = { store.value },
        write = { value -> store.value = value }
    )

    @Test
    fun `first loss does not escalate`() {
        val store = Store()
        assertFalse(tracker(store, now = 1_000L).record())
        assertEquals(1_000L, store.value)
    }

    @Test
    fun `second loss inside the window escalates`() {
        val store = Store()
        tracker(store, now = 1_000L).record()
        // A new Activity is a new tracker over the same persisted timestamp.
        assertTrue(tracker(store, now = 1_000L + 59_999L).record())
    }

    @Test
    fun `second loss after the window does not escalate`() {
        val store = Store()
        tracker(store, now = 1_000L).record()
        assertFalse(tracker(store, now = 1_000L + 60_000L).record())
        // ... and the window moves with the new loss.
        assertTrue(tracker(store, now = 1_000L + 61_000L).record())
    }

    @Test
    fun `a loss in the future never escalates`() {
        // SharedPreferences outlive a reboot, and wall-clock time can be reset
        // backwards; a "recent" test on a negative delta would escalate forever.
        val store = Store(value = 5_000_000L)
        assertFalse(tracker(store, now = 1_000L).record())
        assertEquals(1_000L, store.value)
    }

    @Test
    fun `reset forgets the history`() {
        val store = Store()
        val loss = tracker(store, now = 1_000L)
        assertFalse(loss.record())
        loss.reset()
        assertEquals(0L, store.value)
        assertFalse(tracker(store, now = 2_000L).record())
    }

    @Test
    fun `a resumed activity rebuilds on the first loss`() {
        assertEquals(
            RendererLossAction.REBUILD_NOW,
            LeoApp.rendererLossAction(resumed = true, escalate = false)
        )
    }

    @Test
    fun `a backgrounded activity defers the rebuild`() {
        assertEquals(
            RendererLossAction.DEFER_REBUILD,
            LeoApp.rendererLossAction(resumed = false, escalate = false)
        )
    }

    @Test
    fun `an escalating loss recovers immediately only when resumed`() {
        assertEquals(
            RendererLossAction.RECOVER_NOW,
            LeoApp.rendererLossAction(resumed = true, escalate = true)
        )
        // Never start an Activity from the background (Android 10+ blocks it).
        assertEquals(
            RendererLossAction.DEFER_RECOVERY,
            LeoApp.rendererLossAction(resumed = false, escalate = true)
        )
    }

    @Test
    fun `only the deferred actions are decided while backgrounded`() {
        val actions = RendererLossAction.entries
        assertEquals(4, actions.size)
        assertTrue(RendererLossAction.DEFER_REBUILD in actions)
        assertTrue(RendererLossAction.DEFER_RECOVERY in actions)
    }
}
