package dev.leocode

import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import dev.leocode.bridge.AppHandler
import dev.leocode.bridge.AppInfo
import dev.leocode.bridge.FsHandler
import dev.leocode.bridge.ProcHandler
import dev.leocode.bridge.RuntimeHandler
import dev.leocode.bridge.SafHandler
import dev.leocode.bridge.SafPort
import dev.leocode.bridge.TermHandler
import dev.leocode.bridge.ThemePort
import dev.leocode.core.OrphanReaper
import dev.leocode.core.PathJail
import dev.leocode.core.PidFileStore
import dev.leocode.core.ProcessSupervisor
import dev.leocode.core.PtySession
import dev.leocode.core.TerminalRegistry
import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.File
import kotlinx.serialization.json.Json

/**
 * App-wide container for the bridge domains (Tasks 5, 10).
 *
 * Holds the private workspace, the path jail, the trash, the terminal registry and
 * the process supervisor. Everything here belongs to the application process, not
 * an Activity: a foreground [SessionService] keeps the process (and its PTYs/jobs)
 * alive while the WebView is gone, and a new page reattaches with `term.attach`.
 */
class AppGraph(private val app: Application) {

    companion object {
        private const val TRASH_DIR = ".trash"
        private const val SHARED_TRASH_DIR = ".leocode-trash"
        private const val RUN_DIR = "run"
    }

    val json = Json { ignoreUnknownKeys = true }

    val workspace = Workspace(app.filesDir)

    val sharedStorageRoot: File? =
        runCatching { Environment.getExternalStorageDirectory().canonicalFile }.getOrNull()

    /** Shared storage is a root only while the legacy permission is granted right now. */
    private val storageGranted: () -> Boolean = {
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M ||
            app.checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) ==
            PackageManager.PERMISSION_GRANTED
    }

    val jail = PathJail(
        workspaceRoot = workspace.workspacesRoot,
        sharedStorageRoot = sharedStorageRoot,
        storageGranted = storageGranted
    )

    val trash = Trash(
        workspaceTrash = File(workspace.root, TRASH_DIR),
        sharedTrash = sharedStorageRoot?.let { File(it, SHARED_TRASH_DIR) }
    )

    val childEnv: Map<String, String> = workspace.childEnv()

    val pidFiles = PidFileStore(File(app.filesDir, RUN_DIR))

    // ------------------------------------------------------------ session count
    //
    // The service notification shows terminals + proc.run jobs. Callbacks arrive
    // from reader/wait threads, so the counters are guarded.

    private val countLock = Any()
    private var terminalCount = 0
    private var processCount = 0
    private var serviceActive = false

    /** Invoked once when the first session starts; the Activity asks for notification permission. */
    @Volatile
    var onFirstSession: (() -> Unit)? = null

    private val supervisor = ProcessSupervisor(childEnv, pidFiles) { count ->
        sessionCountChanged(jobs = count)
    }

    private val terminals = TerminalRegistry(
        spawn = { cwd, env, rows, cols -> PtySession.openShell(cwd, env, rows, cols) },
        pidFiles = pidFiles
    ) { count ->
        sessionCountChanged(terminals = count)
    }

    private val procHandler = ProcHandler(workspace, jail, supervisor)
    private val terminalHandler = TermHandler(workspace, jail, childEnv, terminals, json)
    private val runtimeHandler = RuntimeHandler(app, workspace)

    fun fsHandler(): FsHandler = FsHandler(workspace, jail, trash, json)

    fun appHandler(theme: ThemePort, appInfo: () -> AppInfo): AppHandler =
        AppHandler(theme, appInfo, json)

    fun procHandler(): ProcHandler = procHandler

    fun termHandler(): TermHandler = terminalHandler

    fun safHandler(port: SafPort): SafHandler = SafHandler(port)

    fun runtimeHandler(): RuntimeHandler = runtimeHandler

    fun runningCount(): Int = synchronized(countLock) { terminalCount + processCount }

    /**
     * Kill process groups recorded by a previous app process. Called once from
     * [LeoApp.onCreate], before any new session can be started.
     */
    fun reapOrphans(): Int = runCatching { OrphanReaper(pidFiles).reap() }.getOrDefault(0)

    /**
     * Drop WebView listeners and keep the sessions running. Used when the Activity
     * is destroyed or its renderer dies: the foreground service owns the PTYs now.
     */
    fun detachBridge() {
        runCatching { terminalHandler.detachAll() }
    }

    /** Kill terminal sessions, jobs and runtime installs; used by Stop all and shutdown. */
    fun closeBridge() {
        runCatching { supervisor.close() }
        runCatching { terminalHandler.close() }
        runCatching { runtimeHandler.close() }
        SessionService.stop(app)
    }

    private fun sessionCountChanged(terminals: Int? = null, jobs: Int? = null) {
        val total = synchronized(countLock) {
            if (terminals != null) terminalCount = terminals
            if (jobs != null) processCount = jobs
            terminalCount + processCount
        }

        if (total <= 0) {
            // Ask the service to stop itself instead of stopService(): a fast job can
            // end before the main thread delivers its first start command, and tearing
            // that pending start down throws ForegroundServiceDidNotStartInTime.
            val notify = synchronized(countLock) {
                val wasActive = serviceActive
                serviceActive = false
                wasActive
            }
            if (notify) SessionService.update(app, 0)
            return
        }

        val first = synchronized(countLock) {
            val wasActive = serviceActive
            serviceActive = true
            !wasActive
        }
        if (first) runCatching { onFirstSession?.invoke() }
        SessionService.update(app, total)
    }
}
