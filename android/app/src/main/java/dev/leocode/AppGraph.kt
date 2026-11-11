package dev.leocode

import android.app.Application
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import dev.leocode.bridge.AppHandler
import dev.leocode.bridge.FsHandler
import dev.leocode.bridge.ProcHandler
import dev.leocode.bridge.RuntimeHandler
import dev.leocode.bridge.SafHandler
import dev.leocode.bridge.SafPort
import dev.leocode.bridge.TermHandler
import dev.leocode.bridge.ThemePort
import dev.leocode.core.PathJail
import dev.leocode.core.ProcessSupervisor
import dev.leocode.core.Trash
import dev.leocode.core.Workspace
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * App-wide container for the bridge domains (Task 5).
 *
 * Holds the private workspace, the path jail and the trash, and builds the
 * handlers that need them. It deliberately holds no Activity, WebView or theme
 * state; the Activity supplies the [ThemePort] and the `app.info` payload.
 */
class AppGraph(private val app: Application) {

    companion object {
        private const val TRASH_DIR = ".trash"
        private const val SHARED_TRASH_DIR = ".leocode-trash"
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

    private val supervisor = ProcessSupervisor(childEnv)
    private val procHandler = ProcHandler(workspace, jail, supervisor)
    private val terminalHandler = TermHandler(workspace, jail, childEnv)
    private val runtimeHandler = RuntimeHandler(app, workspace)

    fun fsHandler(): FsHandler = FsHandler(workspace, jail, trash, json)

    fun appHandler(theme: ThemePort, appInfo: () -> JsonObject): AppHandler =
        AppHandler(theme, appInfo, json)

    fun procHandler(): ProcHandler = procHandler

    fun termHandler(): TermHandler = terminalHandler

    fun safHandler(port: SafPort): SafHandler = SafHandler(port)

    fun runtimeHandler(): RuntimeHandler = runtimeHandler

    /** Kill terminal sessions, jobs and runtime installs; called when the bridge closes. */
    fun closeBridge() {
        runCatching { supervisor.close() }
        runCatching { terminalHandler.close() }
        runCatching { runtimeHandler.close() }
    }
}
