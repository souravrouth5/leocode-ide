package dev.leocode

import android.app.Application
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import dev.leocode.bridge.AppHandler
import dev.leocode.bridge.AppInfo
import dev.leocode.bridge.BridgeJson
import dev.leocode.bridge.DraftHandler
import dev.leocode.bridge.FsHandler
import dev.leocode.bridge.GitHandler
import dev.leocode.bridge.ProcHandler
import dev.leocode.bridge.PythonHandler
import dev.leocode.bridge.RuntimeHandler
import dev.leocode.bridge.TrustHandler
import dev.leocode.bridge.SafHandler
import dev.leocode.bridge.SafPort
import dev.leocode.bridge.SearchHandler
import dev.leocode.bridge.SecretHandler
import dev.leocode.bridge.SshHandler
import dev.leocode.bridge.TermHandler
import dev.leocode.bridge.ThemePort
import dev.leocode.bridge.UpdateHandler
import dev.leocode.bridge.WorkspaceHandler
import dev.leocode.core.CrashStore
import dev.leocode.core.Diagnostics
import dev.leocode.core.OrphanReaper
import dev.leocode.core.PathJail
import dev.leocode.core.PidFileStore
import dev.leocode.core.ProcessSupervisor
import dev.leocode.core.PtySession
import dev.leocode.core.PythonProject
import dev.leocode.core.TerminalRegistry
import dev.leocode.core.Trash
import dev.leocode.core.TrustStore
import dev.leocode.core.UpdateChecker
import dev.leocode.core.UpdateInstaller
import dev.leocode.core.Workspace
import dev.leocode.core.secrets.AndroidSecretCipher
import dev.leocode.core.secrets.FileSecretStore
import dev.leocode.git.GitEngine
import dev.leocode.ssh.HostKeyPrompts
import dev.leocode.ssh.KnownHostsStore
import dev.leocode.ssh.SshKeyStore
import dev.leocode.workspace.Drafts
import dev.leocode.workspace.SearchEngine
import dev.leocode.workspace.WorkspaceStore
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
        private const val SECRETS_DIR = "secrets"
        private const val SSH_DIR = "ssh"
        private const val TRUST_FILE = "trust/trust.json"
    }

    val json = BridgeJson.value

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

    /** Multiple projects + recent list (Task 14). `ensure()` below loads the index. */
    val workspaceStore = WorkspaceStore(workspace, trash, json)

    /** Autosaved buffers for the active workspace (Task 15). */
    val drafts = Drafts(app.filesDir, workspaceId = { workspaceStore.activeId() }, json = json)

    /** Workspace-wide search engine (Task 16). */
    val searchEngine = SearchEngine()

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

    private val supervisor = ProcessSupervisor(childEnv, pidFiles) {
        sessionCountChanged()
    }

    private val terminals = TerminalRegistry(
        spawn = { cwd, env, rows, cols -> PtySession.openShell(cwd, env, rows, cols) },
        pidFiles = pidFiles
    ) {
        sessionCountChanged()
    }

    // Phase F: tokens and SSH private keys are sealed with a Keystore key. The
    // cipher is lazy so app start does not touch the Keystore before it is needed.
    private val secretCipher by lazy { AndroidSecretCipher() }

    val secretStore: FileSecretStore by lazy {
        FileSecretStore(File(app.filesDir, SECRETS_DIR), secretCipher)
    }

    val sshDir: File get() = File(app.filesDir, SSH_DIR)

    val sshKeys: SshKeyStore by lazy {
        SshKeyStore(sshDir, secretStore, json)
    }

    val knownHosts: KnownHostsStore by lazy {
        KnownHostsStore(File(sshDir, "known_hosts"))
    }

    val hostKeyPrompts: HostKeyPrompts by lazy { HostKeyPrompts(knownHosts) }

    val gitEngine: GitEngine by lazy {
        GitEngine(
            workspaceRoot = { workspaceStore.activeDirectory() },
            secrets = secretStore,
            keyStore = sshKeys,
            knownHosts = knownHosts,
            prompts = hostKeyPrompts,
            json = json
        )
    }

    /** Per-project trust decisions for scripts, pip, venv and Git hooks (Task 26). */
    val trustStore = TrustStore(File(app.filesDir, TRUST_FILE), json)

    private val activeRoot: () -> File = { workspaceStore.activeDirectory() }

    private val procHandler = ProcHandler(workspace, jail, supervisor, activeRoot)
    private val terminalHandler = TermHandler(workspace, jail, childEnv, terminals, json)
    private val runtimeHandler = RuntimeHandler(
        app,
        workspace,
        log = { line -> android.util.Log.w("LeoCodeRuntime", line) }
    )
    private val trustHandler = TrustHandler(workspace, jail, activeRoot, trustStore, json)
    private val pythonHandler = PythonHandler(
        workspace,
        jail,
        activeRoot,
        trustStore,
        json,
        log = { line -> android.util.Log.w("LeoCodePython", line) }
    )

    fun fsHandler(): FsHandler =
        FsHandler(workspace, jail, trash, json) { workspaceStore.activeDirectory() }

    fun workspaceHandler(): WorkspaceHandler = WorkspaceHandler(workspaceStore, json, drafts)

    fun draftHandler(): DraftHandler = DraftHandler(drafts, json)

    fun searchHandler(): SearchHandler =
        SearchHandler(searchEngine, { workspaceStore.activeDirectory() }, json)

    fun appHandler(
        theme: ThemePort,
        appInfo: () -> AppInfo,
        share: (String) -> Boolean = { false }
    ): AppHandler = AppHandler(theme, appInfo, json, ::diagnostics, share)

    fun procHandler(): ProcHandler = procHandler

    fun termHandler(): TermHandler = terminalHandler

    fun safHandler(port: SafPort): SafHandler = SafHandler(
        port,
        json,
        workspaceRoot = { workspaceStore.activeDirectory() },
        scratchRoot = { workspace.tmp }
    )

    fun runtimeHandler(): RuntimeHandler = runtimeHandler

    /** Signed release manifest and the system installer (Task 28). */
    fun updateHandler(): UpdateHandler =
        UpdateHandler(
            UpdateChecker(app),
            UpdateInstaller(app),
            json,
            log = { line -> android.util.Log.w("LeoCodeUpdate", line) }
        )

    fun trustHandler(): TrustHandler = trustHandler

    fun pythonHandler(): PythonHandler = pythonHandler

    /**
     * Adds `python`/`pip` beside the installed launcher. Existing installations
     * gain the aliases here; a fresh install creates them in `configure()`.
     */
    fun ensurePythonAliases(): Boolean =
        runCatching {
            PythonProject(workspace, workspaceStore.activeDirectory()).ensureAliases()
        }.getOrDefault(false)

    /** Redacted support report for Settings › About › Diagnostics (Task 27). */
    fun diagnostics(): String = runCatching {
        val active = workspaceStore.active()
        Diagnostics.collect(
            app,
            workspace,
            active.id,
            active.name,
            runtimeHandler.catalog().map {
                Diagnostics.RuntimeFact(
                    id = it.id,
                    version = it.version,
                    versionCode = it.versionCode,
                    installed = it.installed,
                    healthy = it.healthy,
                    installedVersionCode = it.installedVersionCode
                )
            },
            CrashStore.peek(app)
        )
    }.getOrElse { error ->
        // Diagnostics must still answer when a subsystem is broken; the
        // exception text goes through the redactor like every other field.
        dev.leocode.core.Redactor.redact(
            "LeoCode diagnostics\nReport unavailable: ${error.javaClass.simpleName}"
        )
    }

    fun gitHandler(): GitHandler = GitHandler(gitEngine, json)

    fun secretHandler(): SecretHandler = SecretHandler(secretStore, json)

    fun sshHandler(): SshHandler = SshHandler(sshKeys, knownHosts, hostKeyPrompts, json)

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
    fun detachBridge(cancelJobs: Boolean = false) {
        // Terminals reattach through term.attach after a new page loads. Jobs
        // have no attach path, so a renderer/finish teardown must cancel them
        // instead of leaving them running into a dead reply proxy (B-09).
        if (cancelJobs) {
            runCatching { supervisor.close() }
            runCatching { gitEngine.cancelAll() }
        }
        runCatching { hostKeyPrompts.cancelAll() }
        runCatching { terminalHandler.detachAll() }
    }

    /** Kill terminal sessions, jobs and runtime installs; used by Stop all and shutdown. */
    fun closeBridge() {
        runCatching { supervisor.close() }
        runCatching { terminalHandler.close() }
        runCatching { runtimeHandler.close() }
        runCatching { gitEngine.cancelAll() }
        runCatching { hostKeyPrompts.cancelAll() }
        SessionService.stop(app)
    }

    /**
     * Reads both counts under the same lock that applies them, so two threads
     * cannot deliver 2 then 1 and leave a phantom notification (B-12/L-03).
     */
    private fun sessionCountChanged() {
        val total = synchronized(countLock) {
            terminalCount = terminals.activeCount()
            processCount = supervisor.activeCount()
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
