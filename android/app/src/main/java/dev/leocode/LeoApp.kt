package dev.leocode

import android.app.Application
import android.content.Context
import android.util.Log
import dev.leocode.core.CrashStore
import dev.leocode.core.ScratchSweeper
import kotlin.concurrent.thread

/**
 * Process entry point. Owns the single [AppGraph] so every Activity sees the
 * same workspace, path jail and trash.
 *
 * Graph construction is guarded: if `ensure()` fails (disk full, a dangling
 * symlink), the failure is recorded in [startupError] and [MainActivity] opens
 * [RecoveryActivity] instead of crashing again before the screen can appear
 * (L-02).
 *
 * It also owns the renderer-loss bookkeeping (L-09): the "two losses in 60 s"
 * rule and the decision to rebuild or recover must survive an Activity
 * recreation, so they live here (and in SharedPreferences) and not in an
 * Activity field that a recreation would silently reset.
 */
class LeoApp : Application() {

    companion object {
        private const val PREFS_RENDERER = "leocode.renderer"
        private const val KEY_LAST_LOSS_AT = "last_loss_at"

        /** Two renderer losses inside this window escalate to RecoveryActivity. */
        const val RENDERER_LOSS_WINDOW_MS = 60_000L

        /**
         * What [MainActivity] should do after the WebView renderer is gone.
         * Starting an Activity from the background is blocked on Android 10+,
         * so anything that needs a window is deferred to `onResume`.
         */
        fun rendererLossAction(resumed: Boolean, escalate: Boolean): RendererLossAction = when {
            escalate && resumed -> RendererLossAction.RECOVER_NOW
            escalate -> RendererLossAction.DEFER_RECOVERY
            resumed -> RendererLossAction.REBUILD_NOW
            else -> RendererLossAction.DEFER_REBUILD
        }
    }

    var graph: AppGraph? = null
        private set

    var startupError: String? = null
        private set

    /**
     * Renderer losses are recorded while the Activity may be backgrounded: the
     * WebView must not be rebuilt there (it starts a new renderer under memory
     * pressure) and RecoveryActivity must not be started from the background.
     * Both flags are read in `onResume`, which is the first moment either action
     * is allowed.
     */
    @Volatile
    var pendingRendererRebuild: Boolean = false

    @Volatile
    var pendingRecovery: Boolean = false

    private val rendererPrefs by lazy {
        getSharedPreferences(PREFS_RENDERER, Context.MODE_PRIVATE)
    }

    /** Timestamp store for the 2-in-60 s rule; persisted, so recreation keeps it. */
    val rendererLoss: RendererLossTracker by lazy {
        RendererLossTracker(
            windowMs = RENDERER_LOSS_WINDOW_MS,
            read = { rendererPrefs.getLong(KEY_LAST_LOSS_AT, 0L) },
            write = { value -> rendererPrefs.edit().putLong(KEY_LAST_LOSS_AT, value).apply() }
        )
    }

    override fun onCreate() {
        super.onCreate()
        // Must run before any MINA/SSHD class is touched: `BuiltinDigests`
        // caches whether SHA-256 exists at class-initialisation time, and on
        // Android 12+ the platform "BC" stub does not provide it. MINA also
        // needs `user.home`, which Android never sets. `filesDir/home` is the
        // same $HOME shells get (see Workspace.childEnv).
        runCatching {
            dev.leocode.ssh.Crypto.ensureProviders(java.io.File(filesDir, "home"))
        }.onFailure { Log.w("LeoCode", "crypto providers unavailable: ${it.message}") }
        CrashStore.install(this)
        try {
            val created = AppGraph(this)
            created.workspace.ensure()
            created.workspaceStore.ensure()
            graph = created
            // Reaping waits up to 200 ms per orphan; keep it off the main thread.
            thread(name = "leocode-reap", isDaemon = true) {
                // Task 26: an existing runtime gains `python`/`pip` aliases without
                // a reinstall; a missing runtime simply skips this.
                created.ensurePythonAliases()
                val reaped = runCatching { created.reapOrphans() }.getOrDefault(0)
                if (reaped > 0) Log.i("LeoCode", "reaped $reaped orphan process group(s)")
                // A killed import/export/restore leaves staging and archive files
                // behind; nothing else deletes them (PD-07). Only entries older
                // than the TTL are touched, so a still-running operation from a
                // previous Activity instance survives.
                val swept = runCatching {
                    ScratchSweeper().sweep(
                        ScratchSweeper.defaultRules(cacheDir, created.workspace.tmp)
                    )
                }.getOrDefault(0)
                if (swept > 0) Log.i("LeoCode", "swept $swept stale scratch entr(ies)")
            }
        } catch (error: Throwable) {
            startupError = error.message ?: error.javaClass.simpleName
            Log.e("LeoCode", "startup failed: ${error.javaClass.simpleName}", error)
        }
    }

    /** For code paths that are only reachable after [startupError] was checked. */
    fun graphOrThrow(): AppGraph = graph ?: error("LeoCode did not start")
}

/** What to do about a lost WebView renderer; see [LeoApp.rendererLossAction]. */
enum class RendererLossAction {
    /** Resumed and this is the first loss in the window: rebuild now. */
    REBUILD_NOW,

    /** Not resumed: record the loss and rebuild in `onResume`. */
    DEFER_REBUILD,

    /** Resumed and this is the second loss in the window: show RecoveryActivity. */
    RECOVER_NOW,

    /** Not resumed and escalating: remember it and show RecoveryActivity in `onResume`. */
    DEFER_RECOVERY
}

/**
 * "Two renderer losses in 60 s" tracker (L-09).
 *
 * Pure Kotlin with injected storage and clock: [LeoApp] backs it with
 * SharedPreferences, tests with a map. A loss is only "recent" when the stored
 * timestamp is in the past *and* inside the window, so a rebooted device (whose
 * stored wall-clock time is ahead of the current one) never escalates on its
 * first loss.
 */
class RendererLossTracker(
    private val windowMs: Long = LeoApp.RENDERER_LOSS_WINDOW_MS,
    private val clock: () -> Long = { System.currentTimeMillis() },
    private val read: () -> Long,
    private val write: (Long) -> Unit
) {

    /** Records a loss; returns true when it is the second one inside the window. */
    fun record(): Boolean {
        val now = clock()
        val previous = read()
        val recent = previous > 0L && now >= previous && now - previous < windowMs
        write(now)
        return recent
    }

    /** Forgets the history, e.g. after RecoveryActivity was launched. */
    fun reset() = write(0L)

    fun lastLossAt(): Long = read()
}
