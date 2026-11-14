package dev.leocode

import android.annotation.SuppressLint
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import android.util.Log
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebResourceErrorCompat
import dev.leocode.bridge.AppInfo
import dev.leocode.bridge.BridgeRouter
import dev.leocode.bridge.SafDocument
import dev.leocode.bridge.SafPort
import dev.leocode.bridge.SafTreeResult
import dev.leocode.bridge.StorageInfo
import dev.leocode.bridge.ThemePort
import dev.leocode.bridge.ThemeState
import dev.leocode.core.AtomicWriter
import dev.leocode.core.CrashStore
import dev.leocode.core.ImportBudget
import dev.leocode.core.ImportStaging
import dev.leocode.core.Workspace
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.ArrayDeque
import java.util.Locale
import kotlin.concurrent.thread

/**
 * The IDE shell: one full-screen WebView served from APK assets over
 * https://appassets.androidplatform.net, with the v1 bridge attached.
 *
 * Task 8 additions: ActivityResult APIs, OnBackPressedDispatcher, edge-to-edge
 * insets forwarded to CSS, renderer-loss recovery, a crash store that opens
 * [RecoveryActivity] on the next launch, and an asset-origin error page.
 *
 * The Phase 0 device harness is debug-only (debug source set, not in release builds):
 *   adb shell am start -n dev.leocode/.HarnessActivity --es run all
 */
class MainActivity : ComponentActivity(), SafPort {

    companion object {
        private const val TAG = "LeoCode"
        private const val DOMAIN = "appassets.androidplatform.net"
        private const val ORIGIN = "https://$DOMAIN"
        private const val START_URL = "$ORIGIN/assets/web/index.html"
        const val DEV_URL_DEFAULT = "http://localhost:5173"
        const val DEV_URL_LOOPBACK = "http://127.0.0.1:5173"

        // The "two losses in 60 s" window lives in LeoApp together with the
        // persisted timestamps, so a recreation cannot reset it (L-09).
        private const val PERMISSION_PREFS = "leocode.permissions"
        private const val ASKED_NOTIFICATIONS = "notifications_asked"

        /** Hard cap for a restore archive copied through SAF. */
        private const val MAX_BACKUP_BYTES = 512L * 1024 * 1024
    }

    private lateinit var themeManager: ThemeManager
    private lateinit var rootLayout: FrameLayout

    private var bridge: BridgeHost? = null
    private var webView: WebView? = null
    private var restoredBannerPending = false
    private var showingErrorPage = false

    /**
     * True between `onResume` and `onPause`. Renderer-loss handling branches on
     * it: Android 10+ blocks background activity starts and rebuilding a WebView
     * in the background starts a new renderer under the same memory pressure, so
     * the rebuild and the recovery decision are deferred to `onResume` (L-09).
     */
    private var resumed = false

    private var insetTopPx = 0f
    private var insetBottomPx = 0f
    private var insetLeftPx = 0f
    private var insetRightPx = 0f
    private var imeBottomPx = 0f

    private var devUrlExtra: String? = null
    private val allowedOrigins = mutableSetOf(ORIGIN)
    private val extraOrigins = mutableSetOf<String>()

    private val assetLoader: WebViewAssetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(DOMAIN)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    // --------------------------------------------------- ActivityResult queues
    //
    // SAF and permission prompts arrive from the bridge's IO thread and may
    // overlap. One launcher per prompt type plus queued callbacks keeps every
    // request matched to its own result; nothing is stored in a single slot.

    private data class OpenRequest(val mime: String, val callback: (Result<SafDocument?>) -> Unit)
    private data class SaveRequest(
        val name: String,
        val content: String,
        val callback: (Result<String?>) -> Unit
    )

    private val openRequests = ArrayDeque<OpenRequest>()
    private var openInFlight = false
    private var pendingOpen: ((Result<SafDocument?>) -> Unit)? = null

    private val saveRequests = ArrayDeque<SaveRequest>()
    private var saveInFlight = false
    private var pendingSave: SaveRequest? = null

    private data class TreeRequest(
        val dest: String?,
        val progress: (Int, Long) -> Unit,
        val callback: (Result<SafTreeResult?>) -> Unit
    )

    private data class ExportRequest(
        val name: String,
        val archive: File,
        val progress: (Int, Long) -> Unit,
        val callback: (Result<String?>) -> Unit
    )

    private data class ArchiveRequest(val callback: (Result<File?>) -> Unit)

    private val treeRequests = ArrayDeque<TreeRequest>()
    private var treeInFlight = false
    private var pendingTree: TreeRequest? = null

    private val exportRequests = ArrayDeque<ExportRequest>()
    private var exportInFlight = false
    private var pendingExport: ExportRequest? = null

    private val archiveRequests = ArrayDeque<ArchiveRequest>()
    private var archiveInFlight = false
    private var pendingArchive: ArchiveRequest? = null

    private val permissionRequests = ArrayDeque<(Boolean) -> Unit>()
    private var permissionInFlight = false
    private var pendingPermission: ((Boolean) -> Unit)? = null

    private val openLauncher: ActivityResultLauncher<Array<String>> =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            openInFlight = false
            val callback = pendingOpen
            pendingOpen = null
            if (uri == null) {
                callback?.invoke(Result.success(null))
            } else {
                thread(name = "leocode-saf-read") {
                    // A revoked/offline provider must become E_IO, not an uncaught
                    // exception that kills the process (S-10).
                    val result = runCatching {
                        val name = queryUriFileName(uri)
                        val content = readUriContent(uri)
                        SafDocument(
                            name = name,
                            uri = uri.toString(),
                            content = content,
                            size = content.toByteArray(Charsets.UTF_8).size
                        )
                    }
                    callback?.invoke(result)
                }
            }
            pumpOpen()
        }

    private val saveLauncher: ActivityResultLauncher<String> =
        registerForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri ->
            saveInFlight = false
            val request = pendingSave
            pendingSave = null
            if (request != null) {
                // Report a failed write instead of a URI that points at nothing
                // or at a truncated document (S-11).
                val result = if (uri == null) {
                    Result.success(null)
                } else {
                    runCatching {
                        val stream = contentResolver.openOutputStream(uri)
                            ?: throw IOException("the provider returned no output stream")
                        stream.use {
                            it.write(request.content.toByteArray(Charsets.UTF_8))
                            it.flush()
                        }
                        uri.toString()
                    }
                }
                request.callback(result)
            }
            pumpSave()
        }

    private val treeLauncher: ActivityResultLauncher<Uri?> =
        registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { uri ->
            treeInFlight = false
            val request = pendingTree
            pendingTree = null
            if (request == null) {
                pumpTree()
                return@registerForActivityResult
            }
            if (uri == null) {
                request.callback(Result.success(null))
                pumpTree()
                return@registerForActivityResult
            }
            thread(name = "leocode-saf-import") {
                val result = runCatching { importTree(uri, request) }
                request.callback(result)
                runOnUiThread { pumpTree() }
            }
        }

    private val exportLauncher: ActivityResultLauncher<String> =
        registerForActivityResult(ActivityResultContracts.CreateDocument("application/zip")) { uri ->
            exportInFlight = false
            val request = pendingExport
            pendingExport = null
            if (request == null) {
                pumpExport()
                return@registerForActivityResult
            }
            if (uri == null) {
                request.archive.delete()
                request.callback(Result.success(null))
                pumpExport()
                return@registerForActivityResult
            }
            thread(name = "leocode-saf-export") {
                val result = runCatching {
                    val output = contentResolver.openOutputStream(uri)
                        ?: throw IOException("the provider returned no output stream")
                    var copied = 0L
                    output.use { stream ->
                        request.archive.inputStream().use { input ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = input.read(buffer)
                                if (read < 0) break
                                stream.write(buffer, 0, read)
                                copied += read
                                if (copied % (1024 * 1024) < buffer.size) {
                                    request.progress(0, copied)
                                }
                            }
                            stream.flush()
                        }
                    }
                    uri.toString()
                }
                request.archive.delete()
                request.callback(result)
                runOnUiThread { pumpExport() }
            }
        }

    private val archiveLauncher: ActivityResultLauncher<Array<String>> =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            archiveInFlight = false
            val request = pendingArchive
            pendingArchive = null
            if (request == null) {
                pumpArchive()
                return@registerForActivityResult
            }
            if (uri == null) {
                request.callback(Result.success(null))
                pumpArchive()
                return@registerForActivityResult
            }
            thread(name = "leocode-saf-restore") {
                // The local copy only lives until SafHandler restored it. Every
                // failure path deletes it: a partial archive can be up to
                // MAX_BACKUP_BYTES in cacheDir (PD-07).
                val target = File(cacheDir, "restore-${System.currentTimeMillis()}.zip")
                val result = try {
                    val input = contentResolver.openInputStream(uri)
                        ?: throw IOException("the provider returned no input stream")
                    var total = 0L
                    input.use { stream ->
                        target.outputStream().buffered().use { output ->
                            val buffer = ByteArray(64 * 1024)
                            while (true) {
                                val read = stream.read(buffer)
                                if (read < 0) break
                                total += read
                                if (total > MAX_BACKUP_BYTES) {
                                    throw IOException("backup is larger than the limit")
                                }
                                output.write(buffer, 0, read)
                            }
                            output.flush()
                        }
                    }
                    Result.success(target)
                } catch (error: Throwable) {
                    target.delete()
                    Result.failure(error)
                }
                request.callback(result)
                runOnUiThread { pumpArchive() }
            }
        }

    private val permissionLauncher: ActivityResultLauncher<Array<String>> =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            permissionInFlight = false
            val callback = pendingPermission
            pendingPermission = null
            callback?.invoke(result[android.Manifest.permission.READ_EXTERNAL_STORAGE] == true)
            pumpPermission()
        }

    // Android 13+ hides foreground-service notifications without this permission.
    // Ask when the first terminal/job starts, never at app launch.
    private val notificationPermissionLauncher: ActivityResultLauncher<String> =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val firstSessionCallback: () -> Unit = {
        runOnUiThread { requestNotificationPermissionIfNeeded() }
    }

    // ---------------------------------------------------------------- lifecycle

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // A failed AppGraph construction happened before any Activity could run.
        // Show the native recovery screen instead of looping on "app keeps stopping".
        val app = application as LeoApp
        if (app.startupError != null) {
            startActivity(
                Intent(this, RecoveryActivity::class.java)
                    .putExtra(RecoveryActivity.EXTRA_REASON, RecoveryActivity.REASON_STARTUP)
                    .putExtra(RecoveryActivity.EXTRA_MESSAGE, app.startupError)
            )
            finish()
            return
        }

        // Debug-only recovery demo: `am start ... --ez forceCrash true`. The crash
        // handler stores a redacted record; the next launch opens RecoveryActivity.
        if (BuildConfig.DEBUG && intent?.getBooleanExtra("forceCrash", false) == true) {
            throw IllegalStateException("LeoCode debug forced crash")
        }

        // A crash from the previous process takes priority over the IDE: show the
        // native recovery screen and let the user decide what to do next.
        val crash = CrashStore.consume(this)
        if (crash != null) {
            startActivity(
                Intent(this, RecoveryActivity::class.java)
                    .putExtra(RecoveryActivity.EXTRA_CRASH, CrashStore.encode(crash))
            )
            finish()
            return
        }

        WindowCompat.setDecorFitsSystemWindows(window, false)
        themeManager = ThemeManager(this)
        themeManager.applyToWindow()
        configureOrigins()

        rootLayout = FrameLayout(this).apply {
            setBackgroundColor(themeManager.background())
        }
        ViewCompat.setOnApplyWindowInsetsListener(rootLayout) { _, insets ->
            applyWindowInsets(insets)
            insets
        }
        setContentView(rootLayout)

        installBackDispatcher()
        app.graphOrThrow().onFirstSession = firstSessionCallback
        // A renderer lost while this Activity was not resumed is rebuilt in
        // onResume, not here: onCreate can run in the background (L-09).
        if (app.pendingRecovery || app.pendingRendererRebuild) {
            return
        }
        attachWebView()
    }

    override fun onDestroy() {
        val graph = (application as LeoApp).graphOrThrow()
        if (graph.onFirstSession === firstSessionCallback) {
            graph.onFirstSession = null
        }
        // The foreground service owns the PTYs now. Detach this WebView's listeners
        // instead of killing sessions, so a new Activity can term.attach them.
        // Terminals survive a configuration recreation; jobs cannot reattach,
        // so they are cancelled only when the Activity is really finishing (B-09).
        graph.detachBridge(isFinishing)
        val old = webView
        webView = null
        bridge?.detach()
        bridge = null
        if (old != null) {
            runCatching { (old.parent as? ViewGroup)?.removeView(old) }
            runCatching { old.destroy() }
        }
        super.onDestroy()
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        if (!::themeManager.isInitialized) return
        val app = application as LeoApp
        // Deferred renderer-loss handling (L-09). This is the first point where
        // starting RecoveryActivity and rebuilding the WebView are allowed.
        if (app.pendingRecovery) {
            app.pendingRecovery = false
            app.pendingRendererRebuild = false
            app.rendererLoss.reset()
            startActivity(
                Intent(this, RecoveryActivity::class.java)
                    .putExtra(RecoveryActivity.EXTRA_REASON, RecoveryActivity.REASON_RENDERER)
            )
            finish()
            return
        }
        if (app.pendingRendererRebuild && !isFinishing) {
            app.pendingRendererRebuild = false
            rebuildRenderer()
        }
        themeManager.applyToWindow()
        webView?.onResume()
    }

    override fun onPause() {
        resumed = false
        webView?.onPause()
        super.onPause()
    }

    /**
     * `configChanges` in the manifest now covers keyboard, navigation, fontScale,
     * density, locale, layoutDirection and colorMode, so a Bluetooth keyboard or
     * a font-size change no longer recreates the Activity and reloads the page
     * (L-10). Nothing else here changes: the theme, the WebView background and
     * the insets still have to be re-applied by hand.
     */
    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (!::themeManager.isInitialized) return
        themeManager.applyToWindow()
        webView?.setBackgroundColor(themeManager.background())
        bridge?.pushTheme()
        if (::rootLayout.isInitialized) {
            // Insets depend on orientation, cutout and navigation mode; the
            // listener re-publishes --inset-* to the page.
            rootLayout.requestApplyInsets()
            pushInsets()
        }
    }

    // ------------------------------------------------------------------ back

    private fun installBackDispatcher() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val view = webView
                if (view == null || showingErrorPage) {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                    isEnabled = true
                    return
                }
                view.evaluateJavascript(
                    "(window.__leocodeBack && window.__leocodeBack()) ? 'true' : 'false'"
                ) { result ->
                    if (result?.trim('"') != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                        isEnabled = true
                    }
                }
            }
        })
    }

    // ---------------------------------------------------------------- WebView

    private fun configureOrigins() {
        devUrlExtra = if (BuildConfig.DEBUG) intent?.getStringExtra("devUrl") else null
        if (!BuildConfig.DEBUG) return
        allowedOrigins.add(DEV_URL_DEFAULT)
        allowedOrigins.add(DEV_URL_LOOPBACK)
        devUrlExtra?.let { url ->
            runCatching {
                val uri = Uri.parse(url)
                val origin = "${uri.scheme}://${uri.authority}"
                allowedOrigins.add(origin)
                extraOrigins.add(origin)
            }
        }
    }

    /** Creates the WebView and adds it to the root; reused by renderer recovery. */
    @SuppressLint("SetJavaScriptEnabled")
    private fun attachWebView() {
        showingErrorPage = false
        val view = WebView(this).apply {
            setBackgroundColor(themeManager.background())
            overScrollMode = View.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                allowFileAccess = false
                allowContentAccess = false
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                mediaPlaybackRequiresUserGesture = true
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                cacheMode = WebSettings.LOAD_DEFAULT
                textZoom = 100
                userAgentString = "$userAgentString LeoCode/${BuildConfig.VERSION_NAME}"
            }
        }

        view.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d("LeoCodeWeb", "${message.message()}  (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }

        view.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val url = request.url
                if (url.scheme == "https" && url.host == DOMAIN) return false
                if (BuildConfig.DEBUG) {
                    val origin = "${url.scheme}://${url.authority}"
                    if (allowedOrigins.contains(origin)) return false
                    if ((url.scheme == "http" || url.scheme == "ws") &&
                        (url.host == "localhost" || url.host == "127.0.0.1")
                    ) {
                        return false
                    }
                }
                // Anything else (docs links, imports) opens in a real browser; the IDE
                // WebView never navigates away from its own origin.
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (view !== webView) return
                bridge?.pushTheme()
                pushInsets()
                if (restoredBannerPending) {
                    restoredBannerPending = false
                    showRestoredBanner(view)
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceErrorCompat
            ) {
                if (view !== webView) return
                if (!request.isForMainFrame) {
                    Log.w(TAG, "subresource failed: ${request.url} (${error.errorCode})")
                    return
                }
                Log.e(TAG, "main frame failed: ${request.url} (${error.errorCode}) ${error.description}")
                if (request.url.toString().startsWith(ORIGIN)) {
                    showAssetErrorPage(view, error.description.toString())
                } else if (BuildConfig.DEBUG) {
                    // The dev server went away: fall back to the embedded bundle.
                    Log.w(TAG, "dev server failed; loading embedded assets")
                    view.loadUrl(currentAssetUrl())
                }
            }

            override fun onRenderProcessGone(
                view: WebView,
                detail: RenderProcessGoneDetail
            ): Boolean {
                if (view !== webView) return true
                handleRendererGone(detail.didCrash())
                return true
            }
        }

        webView = view
        rootLayout.addView(
            view,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        val router = BridgeRouter(
            (application as LeoApp).graphOrThrow().json,
            listOf(
                (application as LeoApp).graphOrThrow().appHandler(themePort()) { appInfo() },
                (application as LeoApp).graphOrThrow().fsHandler(),
                (application as LeoApp).graphOrThrow().workspaceHandler(),
                (application as LeoApp).graphOrThrow().draftHandler(),
                (application as LeoApp).graphOrThrow().searchHandler(),
                (application as LeoApp).graphOrThrow().procHandler(),
                (application as LeoApp).graphOrThrow().termHandler(),
                (application as LeoApp).graphOrThrow().safHandler(this),
                (application as LeoApp).graphOrThrow().runtimeHandler()
            ),
            { message -> Log.w("LeoCodeBridge", message) }
        )

        val host = BridgeHost(
            view,
            themePort(),
            extraOrigins,
            router,
            onClose = { (application as LeoApp).graphOrThrow().closeBridge() }
        )
        bridge = host

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                view,
                "LeoCodeAndroid",
                allowedOrigins,
                host
            )
            loadInitialPage(view)
        } else {
            view.loadDataWithBaseURL(
                null,
                """
                <!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
                <body style="font-family:system-ui;padding:24px;background:#0f1115;color:#e6e9ef">
                  <h2>WebView is too old</h2>
                  <p>LeoCode needs Android System WebView / Chrome 100 or newer.
                  Update it from the Play Store and reopen the app.</p>
                </body>
                """.trimIndent(),
                "text/html",
                "utf-8",
                null
            )
        }

        ViewCompat.requestApplyInsets(rootLayout)
    }

    /**
     * The renderer is a separate process that Android kills when it runs out of
     * memory. Returning true from onRenderProcessGone prevents a process crash;
     * one loss rebuilds the WebView, two in a minute escalate to the native
     * recovery screen (the page may be stuck in a loop).
     *
     * A loss that arrives while the Activity is not resumed is only *recorded*
     * (L-09): rebuilding would start a new renderer under the same memory
     * pressure, and `startActivity(RecoveryActivity)` is a background activity
     * start, which Android 10+ blocks — the old code then finished itself and
     * left the process with no UI at all. `onResume` performs the deferred step.
     */
    private fun handleRendererGone(didCrash: Boolean) {
        val app = application as LeoApp
        val escalate = app.rendererLoss.record()
        val action = LeoApp.rendererLossAction(resumed = resumed, escalate = escalate)
        Log.e(
            TAG,
            "WebView renderer gone (crash=$didCrash, escalate=$escalate, action=$action)"
        )

        // Drop the dead view and transport first. Terminals survive for the
        // replacement view; jobs have no reattach path, so cancel them (B-09).
        val old = webView
        webView = null
        app.graphOrThrow().detachBridge(cancelJobs = true)
        bridge?.detach()
        bridge = null
        if (old != null) {
            runCatching { old.stopLoading() }
            runCatching { (old.parent as? ViewGroup)?.removeView(old) }
            runCatching { old.destroy() }
        }

        when (action) {
            RendererLossAction.RECOVER_NOW -> {
                app.rendererLoss.reset()
                startActivity(
                    Intent(this, RecoveryActivity::class.java)
                        .putExtra(RecoveryActivity.EXTRA_REASON, RecoveryActivity.REASON_RENDERER)
                )
                finish()
            }

            // Never start an Activity from the background.
            RendererLossAction.DEFER_RECOVERY -> {
                app.pendingRecovery = true
            }

            RendererLossAction.REBUILD_NOW -> rebuildRenderer()

            RendererLossAction.DEFER_REBUILD -> {
                app.pendingRendererRebuild = true
            }
        }
    }

    private fun rebuildRenderer() {
        restoredBannerPending = true
        attachWebView()
        Toast.makeText(this, "Restored after a problem", Toast.LENGTH_SHORT).show()
    }

    private fun showRestoredBanner(view: WebView) {
        view.evaluateJavascript(
            """
            (function () {
              var id = 'leocode-restored-banner';
              var old = document.getElementById(id);
              if (old) old.parentNode.removeChild(old);
              var el = document.createElement('div');
              el.id = id;
              el.textContent = 'Restored after a problem';
              el.style.cssText = 'position:fixed;left:50%;top:calc(var(--inset-top, 0px) + 12px);' +
                'transform:translateX(-50%);z-index:2147483647;background:#1b2028;color:#fff;' +
                'padding:8px 14px;border-radius:999px;font:500 13px system-ui,sans-serif;' +
                'box-shadow:0 6px 20px rgba(0,0,0,.35);white-space:nowrap;';
              document.body.appendChild(el);
              setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 4000);
            })()
            """.trimIndent(),
            null
        )
    }

    private fun showAssetErrorPage(view: WebView, message: String) {
        showingErrorPage = true
        val safe = message.replace("<", "&lt;").replace(">", "&gt;")
        view.loadDataWithBaseURL(
            null,
            """
            <!doctype html>
            <html><head><meta name="viewport" content="width=device-width,initial-scale=1">
            <style>
              body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;
                   color:#e6e9ef;font-family:system-ui,sans-serif;padding:24px;text-align:center}
              h2{margin:0 0 8px;font-size:19px} p{margin:0 0 20px;color:#b9c0cc;font-size:14px}
              a{display:inline-block;padding:10px 18px;border-radius:10px;background:#2563eb;
                color:#fff;text-decoration:none;font-weight:600}
            </style></head>
            <body><div>
              <h2>Could not load LeoCode</h2>
              <p>The embedded app failed to start.<br>$safe</p>
              <a href="$START_URL">Retry</a>
            </div></body></html>
            """.trimIndent(),
            "text/html",
            "utf-8",
            null
        )
    }

    // ----------------------------------------------------------------- insets

    /**
     * Edge-to-edge: Android owns the real insets, CSS owns the layout. The page
     * reads --inset-top (status bar or cutout), --inset-left / --inset-right
     * (side navigation bar or cutout, the landscape case), --inset-bottom
     * (navigation bar) and --ime-bottom (keyboard above the navigation bar).
     *
     * Left and right were dropped before L-11, so in landscape with a three
     * button navigation bar, or on a notch device, the shell drew its content
     * under the bar. Each side takes the larger of the system bars and the
     * display cutout, because the status bar insets do not include the cutout.
     */
    private fun applyWindowInsets(insets: WindowInsetsCompat) {
        val density = resources.displayMetrics.density.takeIf { it > 0f } ?: 1f
        val status = insets.getInsets(WindowInsetsCompat.Type.statusBars())
        val nav = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
        val imePx = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        } else {
            @Suppress("DEPRECATION")
            insets.systemWindowInsetBottom
        }
        insetTopPx = InsetsScript.widest(status.top, cutout.top) / density
        insetBottomPx = nav.bottom / density
        insetLeftPx = InsetsScript.widest(bars.left, cutout.left) / density
        insetRightPx = InsetsScript.widest(bars.right, cutout.right) / density
        imeBottomPx = (imePx - nav.bottom).coerceAtLeast(0) / density
        pushInsets()
    }

    private fun pushInsets() {
        val view = webView ?: return
        val js = InsetsScript.build(
            topPx = insetTopPx,
            bottomPx = insetBottomPx,
            leftPx = insetLeftPx,
            rightPx = insetRightPx,
            imeBottomPx = imeBottomPx
        )
        view.post { runCatching { view.evaluateJavascript(js, null) } }
    }

    // ------------------------------------------------------------- SAF / perms

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val prefs = getSharedPreferences(PERMISSION_PREFS, MODE_PRIVATE)
        if (prefs.getBoolean(ASKED_NOTIFICATIONS, false)) return
        prefs.edit().putBoolean(ASKED_NOTIFICATIONS, true).apply()
        runCatching { notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS) }
    }

    private fun checkStoragePermission(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }

    override fun requestStoragePermission(callback: (Boolean) -> Unit) {
        if (checkStoragePermission()) {
            callback(true)
            return
        }
        runOnUiThread {
            permissionRequests.addLast(callback)
            pumpPermission()
        }
    }

    private fun pumpPermission() {
        if (permissionInFlight) return
        val next = permissionRequests.pollFirst() ?: return
        permissionInFlight = true
        pendingPermission = next
        runCatching {
            permissionLauncher.launch(
                arrayOf(
                    android.Manifest.permission.READ_EXTERNAL_STORAGE,
                    android.Manifest.permission.WRITE_EXTERNAL_STORAGE
                )
            )
        }.onFailure {
            permissionInFlight = false
            pendingPermission = null
            next(false)
        }
    }

    override fun openDocument(mime: String, onResult: (Result<SafDocument?>) -> Unit) {
        runOnUiThread {
            openRequests.addLast(OpenRequest(mime, onResult))
            pumpOpen()
        }
    }

    private fun pumpOpen() {
        if (openInFlight) return
        val next = openRequests.pollFirst() ?: return
        openInFlight = true
        pendingOpen = next.callback
        runCatching { openLauncher.launch(arrayOf(next.mime)) }.onFailure {
            openInFlight = false
            pendingOpen = null
            next.callback(Result.failure(it))
        }
    }

    override fun saveDocument(name: String, content: String, onResult: (Result<String?>) -> Unit) {
        runOnUiThread {
            saveRequests.addLast(SaveRequest(name, content, onResult))
            pumpSave()
        }
    }

    private fun pumpSave() {
        if (saveInFlight) return
        val next = saveRequests.pollFirst() ?: return
        saveInFlight = true
        pendingSave = next
        runCatching { saveLauncher.launch(next.name) }.onFailure {
            saveInFlight = false
            pendingSave = null
            next.callback(Result.failure(it))
        }
    }

    // ---------------------------------------------- SAF trees and backups (D14)

    override fun importTree(
        dest: String?,
        onProgress: (Int, Long) -> Unit,
        onResult: (Result<SafTreeResult?>) -> Unit
    ) {
        runOnUiThread {
            treeRequests.addLast(TreeRequest(dest, onProgress, onResult))
            pumpTree()
        }
    }

    private fun pumpTree() {
        if (treeInFlight) return
        val next = treeRequests.pollFirst() ?: return
        treeInFlight = true
        pendingTree = next
        runCatching { treeLauncher.launch(null) }.onFailure {
            treeInFlight = false
            pendingTree = null
            next.callback(Result.failure(it))
        }
    }

    override fun exportArchive(
        name: String,
        archive: File,
        onProgress: (Int, Long) -> Unit,
        onResult: (Result<String?>) -> Unit
    ) {
        runOnUiThread {
            exportRequests.addLast(ExportRequest(name, archive, onProgress, onResult))
            pumpExport()
        }
    }

    private fun pumpExport() {
        if (exportInFlight) return
        val next = exportRequests.pollFirst() ?: return
        exportInFlight = true
        pendingExport = next
        runCatching { exportLauncher.launch(next.name) }.onFailure {
            exportInFlight = false
            pendingExport = null
            next.archive.delete()
            next.callback(Result.failure(it))
        }
    }

    override fun openArchive(onResult: (Result<File?>) -> Unit) {
        runOnUiThread {
            archiveRequests.addLast(ArchiveRequest(onResult))
            pumpArchive()
        }
    }

    private fun pumpArchive() {
        if (archiveInFlight) return
        val next = archiveRequests.pollFirst() ?: return
        archiveInFlight = true
        pendingArchive = next
        runCatching {
            archiveLauncher.launch(arrayOf("application/zip", "application/octet-stream"))
        }.onFailure {
            archiveInFlight = false
            pendingArchive = null
            next.callback(Result.failure(it))
        }
    }

    /**
     * Copies a SAF document tree into the active workspace. Runs on a worker
     * thread; every file is written under a fresh name, so an import never
     * silently overwrites a document that already exists.
     *
     * The provider is copied into a staging directory under `workspace.tmp`
     * first (PD-06). Only a complete copy is moved into the workspace, so a
     * provider error or a cap hit leaves the workspace exactly as it was, and
     * the real reason (limit, nesting) reaches `SafHandler`.
     */
    private fun importTree(treeUri: Uri, request: TreeRequest): SafTreeResult {
        val graph = (application as LeoApp).graphOrThrow()
        val active = graph.workspaceStore.activeDirectory()
        val activeCanonical = active.canonicalFile
        val rootId = DocumentsContract.getTreeDocumentId(treeUri)
        val rootUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, rootId)
        val rootName = sanitizeName(queryDisplayName(rootUri) ?: "Imported folder")

        val budget = ImportBudget()
        val staging = ImportStaging.createStaging(graph.workspace.tmp)
        var committed: File? = null
        try {
            fun copy(uri: Uri, dir: File, depth: Int) {
                budget.checkDepth(depth)
                val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                    treeUri,
                    DocumentsContract.getDocumentId(uri)
                )
                contentResolver.query(
                    childrenUri,
                    arrayOf(
                        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE
                    ),
                    null,
                    null,
                    null
                )?.use { cursor ->
                    while (cursor.moveToNext()) {
                        val documentId = cursor.getString(0) ?: continue
                        val displayName = sanitizeName(cursor.getString(1) ?: "file")
                        val mime = cursor.getString(2) ?: ""
                        val childUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId)
                        if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                            val name = ImportStaging.availableName(dir, displayName, directory = true)
                            val childDir = File(dir, name)
                            if (!childDir.mkdirs() && !childDir.isDirectory) {
                                throw IOException("cannot create ${childDir.name}")
                            }
                            copy(childUri, childDir, depth + 1)
                        } else {
                            val name = ImportStaging.availableName(dir, displayName, directory = false)
                            val destination = File(dir, name)
                            val input = contentResolver.openInputStream(childUri)
                                ?: throw IOException("the provider returned no input stream")
                            input.use { stream ->
                                destination.outputStream().buffered().use { output ->
                                    val buffer = ByteArray(64 * 1024)
                                    while (true) {
                                        val read = stream.read(buffer)
                                        if (read < 0) break
                                        output.write(buffer, 0, read)
                                        budget.addBytes(read.toLong())
                                        if (budget.bytes % (256 * 1024) < buffer.size) {
                                            request.progress(budget.files, budget.bytes)
                                        }
                                    }
                                    output.flush()
                                }
                            }
                            budget.addFile()
                            request.progress(budget.files, budget.bytes)
                        }
                    }
                }
            }

            copy(rootUri, staging, 0)

            val dest = request.dest
            if (dest.isNullOrBlank()) {
                committed = ImportStaging.moveIntoWorkspace(staging, active, rootName)
            } else {
                val resolved = graph.jail.resolve(dest, active)
                if (!resolved.isDirectory && !resolved.mkdirs() && !resolved.isDirectory) {
                    throw IOException("cannot create the destination folder")
                }
                ImportStaging.moveChildren(staging, resolved)
                committed = resolved
            }
        } finally {
            // After a successful move the staging directory is empty or gone;
            // on any failure this removes the partial tree, so the workspace is
            // never left with a half import.
            ImportStaging.deleteRecursively(staging)
        }

        val target = committed ?: throw IOException("the import did not finish")
        val canonicalTarget = target.canonicalFile
        val path = if (canonicalTarget == activeCanonical) {
            "."
        } else {
            val prefix = activeCanonical.path + File.separator
            if (canonicalTarget.path.startsWith(prefix)) {
                canonicalTarget.path.substring(prefix.length).replace(File.separatorChar, '/')
            } else {
                canonicalTarget.absolutePath
            }
        }
        return SafTreeResult(path, budget.files, budget.bytes)
    }

    private fun queryDisplayName(uri: Uri): String? {
        var name: String? = null
        runCatching {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (index != -1 && cursor.moveToFirst()) name = cursor.getString(index)
            }
        }
        return name
    }

    private fun sanitizeName(raw: String): String {
        val cleaned = raw.replace('/', '_').replace('\\', '_').replace("\u0000", "").trim()
        val name = cleaned.ifEmpty { "file" }
        return if (name.length <= 100) name else name.take(100)
    }

    override fun storageInfo(): StorageInfo {
        val graph = (application as LeoApp).graphOrThrow()
        return StorageInfo(
            hasPermission = checkStoragePermission(),
            internalStorage = Environment.getExternalStorageDirectory().absolutePath,
            downloads = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOWNLOADS
            ).absolutePath,
            documents = Environment.getExternalStoragePublicDirectory(
                Environment.DIRECTORY_DOCUMENTS
            ).absolutePath,
            workspace = graph.workspaceStore.activeDirectory().absolutePath
        )
    }

    private fun queryUriFileName(uri: Uri): String {
        var name = "document.txt"
        runCatching {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                if (nameIndex != -1 && cursor.moveToFirst()) {
                    name = cursor.getString(nameIndex) ?: name
                }
            }
        }
        return name
    }

    /**
     * Reads a SAF document as UTF-8, stopping just past [maxBytes] so a huge
     * pick cannot exhaust the heap. The bridge rejects anything over 4 MB; it
     * must never be handed an unbounded string.
     */
    fun readUriContent(uri: Uri, maxBytes: Int = 4 * 1024 * 1024): String {
        val stream = contentResolver.openInputStream(uri)
            ?: throw IOException("the provider returned no input stream")
        return stream.use { input ->
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var total = 0
            while (total <= maxBytes) {
                val read = input.read(buffer)
                if (read < 0) break
                val keep = minOf(read, maxBytes + 1 - total)
                out.write(buffer, 0, keep)
                total += keep
                if (total > maxBytes) break
            }
            out.toString(Charsets.UTF_8.name())
        }
    }

    // ------------------------------------------------------------------ theme

    private fun themePort(): ThemePort = object : ThemePort {
        override fun state(): ThemeState =
            ThemeState(themeManager.mode, themeManager.effective())

        override fun setMode(mode: String?): ThemeState {
            val changed = themeManager.setMode(mode)
            runOnUiThread {
                themeManager.applyToWindow()
                webView?.setBackgroundColor(themeManager.background())
            }
            if (changed) bridge?.pushTheme()
            return state()
        }
    }

    /**
     * The `app.info` payload. Kept in the Activity because it reports WebView,
     * SDK and workspace details that are only meaningful for this window.
     */
    private fun appInfo(): AppInfo {
        val workspace: Workspace = (application as LeoApp).graphOrThrow().workspace
        return AppInfo(
            app = "LeoCode",
            version = BuildConfig.VERSION_NAME,
            mode = "android",
            androidSdk = Build.VERSION.SDK_INT,
            androidRelease = Build.VERSION.RELEASE,
            abi = Build.SUPPORTED_ABIS.firstOrNull() ?: "",
            webview = runCatching { WebView.getCurrentWebViewPackage()?.versionName }.getOrNull() ?: "",
            workspace = workspace.defaultWorkspace.absolutePath,
            theme = themePort().state()
        )
    }

    // ------------------------------------------------------------------ loading

    private fun currentAssetUrl(): String =
        DevServerConfig.buildPageUrl(START_URL, themeManager.mode, themeManager.effective())

    private fun loadInitialPage(target: WebView) {
        val fallbackUrl = currentAssetUrl()

        // If not a debug build or no explicit dev server was requested, load embedded assets immediately
        if (!BuildConfig.DEBUG ||
            (devUrlExtra.isNullOrBlank() && intent?.getBooleanExtra("devMode", false) != true)
        ) {
            target.loadUrl(fallbackUrl)
            return
        }

        thread(name = "leocode-dev-check") {
            val resolvedUrl = DevServerConfig.resolveDevUrl(devUrlExtra) { url ->
                isServerReachable(url, timeoutMs = 250)
            }
            val finalUrl = if (resolvedUrl != null) {
                Log.i(TAG, "Dev server reachable at $resolvedUrl, loading with hot-reload")
                DevServerConfig.buildPageUrl(resolvedUrl, themeManager.mode, themeManager.effective())
            } else {
                Log.i(TAG, "Dev server not reachable, falling back to embedded assets: $START_URL")
                fallbackUrl
            }

            runOnUiThread {
                if (webView === target && !isFinishing) {
                    target.loadUrl(finalUrl)
                }
            }
        }
    }

    private fun isServerReachable(urlStr: String, timeoutMs: Int): Boolean {
        return try {
            val url = URL(urlStr)
            val conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                requestMethod = "HEAD"
                instanceFollowRedirects = false
            }
            val code = conn.responseCode
            conn.disconnect()
            code in 200..399 || code == 404
        } catch (_: Exception) {
            try {
                val url = URL(urlStr)
                val port = if (url.port != -1) url.port else url.defaultPort
                Socket().use { socket ->
                    socket.connect(InetSocketAddress(url.host, port), timeoutMs)
                    true
                }
            } catch (_: Exception) {
                false
            }
        }
    }
}

/**
 * The JavaScript that publishes the window insets as CSS custom properties
 * (L-11).
 *
 * Kept separate from the Activity so it can be unit-tested: the numbers must be
 * formatted with a dot decimal separator whatever the device locale is,
 * otherwise `--inset-top: 24,0px` is invalid CSS and every padded surface
 * collapses to zero.
 */
internal object InsetsScript {

    /** The larger of two insets; the cutout can exceed the system bar. */
    fun widest(bars: Int, cutout: Int): Int = if (bars > cutout) bars else cutout

    fun build(
        topPx: Float,
        bottomPx: Float,
        leftPx: Float,
        rightPx: Float,
        imeBottomPx: Float
    ): String = listOf(
        "--inset-top" to topPx,
        "--inset-bottom" to bottomPx,
        "--inset-left" to leftPx,
        "--inset-right" to rightPx,
        "--ime-bottom" to imeBottomPx
    ).joinToString(separator = "") { (name, value) ->
        "document.documentElement.style.setProperty('$name','${pixels(value)}px');"
    }

    /** Locale-independent fixed precision, one decimal place. */
    fun pixels(value: Float): String = String.format(Locale.US, "%.1f", value)
}
