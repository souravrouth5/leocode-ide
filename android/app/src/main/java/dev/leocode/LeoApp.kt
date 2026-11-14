package dev.leocode

import android.app.Application
import android.util.Log
import dev.leocode.core.CrashStore

/**
 * Process entry point. Owns the single [AppGraph] so every Activity sees the
 * same workspace, path jail and trash.
 *
 * The crash handler is installed first: if graph construction throws (for
 * example a corrupt workspace), the record is still written and the next launch
 * opens [RecoveryActivity] (Task 8).
 */
class LeoApp : Application() {

    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        CrashStore.install(this)
        graph = AppGraph(this)
        graph.workspace.ensure()
        val reaped = graph.reapOrphans()
        if (reaped > 0) Log.i("LeoCode", "reaped $reaped orphan process group(s)")
    }
}
