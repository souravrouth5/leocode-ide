package dev.leocode

import android.app.Application

/**
 * Process entry point. Owns the single [AppGraph] so every Activity sees the
 * same workspace, path jail and trash.
 */
class LeoApp : Application() {

    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        graph.workspace.ensure()
    }
}
