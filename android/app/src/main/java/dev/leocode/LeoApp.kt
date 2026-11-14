package dev.leocode

import android.app.Application
import android.util.Log
import dev.leocode.core.CrashStore
import kotlin.concurrent.thread

/**
 * Process entry point. Owns the single [AppGraph] so every Activity sees the
 * same workspace, path jail and trash.
 *
 * Graph construction is guarded: if `ensure()` fails (disk full, a dangling
 * symlink), the failure is recorded in [startupError] and [MainActivity] opens
 * [RecoveryActivity] instead of crashing again before the screen can appear
 * (L-02).
 */
class LeoApp : Application() {

    var graph: AppGraph? = null
        private set

    var startupError: String? = null
        private set

    override fun onCreate() {
        super.onCreate()
        CrashStore.install(this)
        try {
            val created = AppGraph(this)
            created.workspace.ensure()
            graph = created
            // Reaping waits up to 200 ms per orphan; keep it off the main thread.
            thread(name = "leocode-reap", isDaemon = true) {
                val reaped = runCatching { created.reapOrphans() }.getOrDefault(0)
                if (reaped > 0) Log.i("LeoCode", "reaped $reaped orphan process group(s)")
            }
        } catch (error: Throwable) {
            startupError = error.message ?: error.javaClass.simpleName
            Log.e("LeoCode", "startup failed: ${error.javaClass.simpleName}", error)
        }
    }

    /** For code paths that are only reachable after [startupError] was checked. */
    fun graphOrThrow(): AppGraph = graph ?: error("LeoCode did not start")
}
