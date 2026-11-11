package dev.leocode

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.OpenableColumns
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import dev.leocode.bridge.BridgeRouter
import dev.leocode.bridge.SafDocument
import dev.leocode.bridge.SafPort
import dev.leocode.bridge.ThemePort
import dev.leocode.core.Workspace
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import kotlin.concurrent.thread

/**
 * The IDE shell: one full-screen WebView served from APK assets over
 * https://appassets.androidplatform.net, with the v1 bridge attached.
 *
 * The Phase 0 device harness is debug-only (debug source set, not in release builds)
 * and is still reachable in a debug build:
 *   adb shell am start -n dev.leocode/.HarnessActivity --es run all
 */
class MainActivity : Activity(), SafPort {

    companion object {
        private const val TAG = "LeoCode"
        private const val DOMAIN = "appassets.androidplatform.net"
        private const val ORIGIN = "https://$DOMAIN"
        private const val START_URL = "$ORIGIN/assets/web/index.html"
        const val DEV_URL_DEFAULT = "http://localhost:5173"
        const val DEV_URL_LOOPBACK = "http://127.0.0.1:5173"
        private const val FIRST_REQUEST_CODE = 3000
    }

    /**
     * Each dialog gets its own request code, so two overlapping SAF picks or a
     * permission prompt cannot overwrite each other's callback (Task 6).
     */
    private var nextRequestCode = java.util.concurrent.atomic.AtomicInteger(FIRST_REQUEST_CODE)
    private val pendingPermissions = java.util.concurrent.ConcurrentHashMap<Int, (Boolean) -> Unit>()
    private val pendingSafOpens = java.util.concurrent.ConcurrentHashMap<Int, (Uri?) -> Unit>()
    private val pendingSafSaves =
        java.util.concurrent.ConcurrentHashMap<Int, Pair<String, (Uri?) -> Unit>>()

    private fun newRequestCode(): Int = nextRequestCode.getAndIncrement()

    private fun checkStoragePermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            checkSelfPermission(android.Manifest.permission.READ_EXTERNAL_STORAGE) ==
                    PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    override fun requestStoragePermission(callback: (Boolean) -> Unit) {
        if (checkStoragePermission()) {
            callback(true)
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val code = newRequestCode()
            pendingPermissions[code] = callback
            runOnUiThread {
                requestPermissions(
                    arrayOf(
                        android.Manifest.permission.READ_EXTERNAL_STORAGE,
                        android.Manifest.permission.WRITE_EXTERNAL_STORAGE
                    ),
                    code
                )
            }
        } else {
            callback(true)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val callback = pendingPermissions.remove(requestCode) ?: return
        callback(grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
    }

    override fun openDocument(mime: String, onResult: (SafDocument?) -> Unit) {
        pickDocument(mime) { uri ->
            if (uri == null) {
                onResult(null)
                return@pickDocument
            }
            thread(name = "leocode-saf-read") {
                val name = queryUriFileName(uri)
                val content = readUriContent(uri)
                onResult(
                    SafDocument(
                        name = name,
                        uri = uri.toString(),
                        content = content,
                        size = content.toByteArray(Charsets.UTF_8).size
                    )
                )
            }
        }
    }

    override fun saveDocument(name: String, content: String, onResult: (String?) -> Unit) {
        saveSafDocument(name, content) { uri -> onResult(uri?.toString()) }
    }

    override fun storageInfo(): JsonObject = buildJsonObject {
        put("hasPermission", checkStoragePermission())
        put("internalStorage", Environment.getExternalStorageDirectory().absolutePath)
        put(
            "downloads",
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath
        )
        put(
            "documents",
            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).absolutePath
        )
        put("workspace", (application as LeoApp).graph.workspace.defaultWorkspace.absolutePath)
    }

    private fun pickDocument(mime: String, callback: (Uri?) -> Unit) {
        val code = newRequestCode()
        pendingSafOpens[code] = callback
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
        }
        runOnUiThread { startActivityForResult(intent, code) }
    }

    private fun saveSafDocument(filename: String, content: String, callback: (Uri?) -> Unit) {
        val code = newRequestCode()
        pendingSafSaves[code] = content to callback
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "text/plain"
            putExtra(Intent.EXTRA_TITLE, filename)
        }
        runOnUiThread { startActivityForResult(intent, code) }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val uri = if (resultCode == RESULT_OK) data?.data else null

        pendingSafOpens.remove(requestCode)?.let { callback ->
            callback(uri)
            return
        }

        val pendingSave = pendingSafSaves.remove(requestCode) ?: return
        val (content, callback) = pendingSave
        if (uri != null) {
            runCatching {
                contentResolver.openOutputStream(uri)?.use { stream ->
                    stream.write(content.toByteArray(Charsets.UTF_8))
                    stream.flush()
                }
            }
        }
        callback(uri)
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
        return contentResolver.openInputStream(uri)?.use { stream ->
            val out = java.io.ByteArrayOutputStream()
            val buffer = ByteArray(64 * 1024)
            var total = 0
            while (total <= maxBytes) {
                val read = stream.read(buffer)
                if (read < 0) break
                val keep = minOf(read, maxBytes + 1 - total)
                out.write(buffer, 0, keep)
                total += keep
                if (total > maxBytes) break
            }
            out.toString(Charsets.UTF_8.name())
        } ?: ""
    }

    /**
     * The `app.info` payload. Kept in the Activity because it reports WebView,
     * SDK and workspace details that are only meaningful for this window.
     */
    private fun appInfoJson(workspace: Workspace, theme: ThemePort): JsonObject = buildJsonObject {
        put("app", "LeoCode")
        put("version", BuildConfig.VERSION_NAME)
        put("mode", "android")
        put("androidSdk", Build.VERSION.SDK_INT)
        put("androidRelease", Build.VERSION.RELEASE)
        put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
        put("webview", runCatching { WebView.getCurrentWebViewPackage()?.versionName }.getOrNull() ?: "")
        put("workspace", workspace.defaultWorkspace.absolutePath)
        put("theme", theme.state())
    }

    private lateinit var themeManager: ThemeManager
    private lateinit var bridge: BridgeHost
    private lateinit var webView: WebView

    private var webViewDestroyed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        themeManager = ThemeManager(this)
        themeManager.applyToWindow()

        val workspace = (application as LeoApp).graph.workspace

        webView = WebView(this).apply {
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

        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d("LeoCodeWeb", "${message.message()}  (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }

        val assets = WebViewAssetLoader.Builder()
            .setDomain(DOMAIN)
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val allowedOrigins = mutableSetOf(ORIGIN)
        val devUrlExtra = if (BuildConfig.DEBUG) intent?.getStringExtra("devUrl") else null
        val extraOrigins = mutableSetOf<String>()

        if (BuildConfig.DEBUG) {
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

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assets.shouldInterceptRequest(request.url)

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
                bridge.pushTheme()
            }
        }

        val themePort = object : ThemePort {
            override fun state(): JsonObject = buildJsonObject {
                put("mode", themeManager.mode)
                put("effective", themeManager.effective())
            }

            override fun setMode(mode: String?): JsonObject {
                val changed = themeManager.setMode(mode)
                runOnUiThread {
                    themeManager.applyToWindow()
                    if (!webViewDestroyed) webView.setBackgroundColor(themeManager.background())
                }
                if (changed && ::bridge.isInitialized) bridge.pushTheme()
                return state()
            }
        }

        val graph = (application as LeoApp).graph
        val router = BridgeRouter(
            graph.json,
            listOf(
                graph.appHandler(themePort) { appInfoJson(workspace, themePort) },
                graph.fsHandler(),
                graph.procHandler(),
                graph.termHandler(),
                graph.safHandler(this),
                graph.runtimeHandler()
            ),
            { message -> Log.w("LeoCodeBridge", message) }
        )

        bridge = BridgeHost(
            webView,
            themePort,
            extraOrigins,
            router,
            onClose = { graph.closeBridge() }
        )

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                webView,
                "LeoCodeAndroid",
                allowedOrigins,
                bridge
            )
            loadInitialPage(devUrlExtra)
        } else {
            webView.loadDataWithBaseURL(
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

        setContentView(
            FrameLayout(this).apply {
                fitsSystemWindows = true
                setBackgroundColor(themeManager.background())
                addView(
                    webView,
                    FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                    )
                )
            }
        )

        // Re-apply once the decor view is attached: some OEM ROMs (MIUI included)
        // only honour navigation-bar colours after layout.
        themeManager.applyToWindow()
    }

    @Deprecated("Deprecated in API 33; kept because this app targets SDK 28.")
    override fun onBackPressed() {
        if (webViewDestroyed) {
            super.onBackPressed()
            return
        }
        webView.evaluateJavascript(
            "(window.__leocodeBack && window.__leocodeBack()) ? 'true' : 'false'"
        ) { result ->
            if (result?.trim('"') != "true") {
                @Suppress("DEPRECATION")
                super.onBackPressed()
            }
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        themeManager.applyToWindow()
        webView.setBackgroundColor(themeManager.background())
        bridge.pushTheme()
    }

    override fun onResume() {
        super.onResume()
        themeManager.applyToWindow()
        if (!webViewDestroyed) webView.onResume()
    }

    override fun onPause() {
        super.onPause()
        if (!webViewDestroyed) webView.onPause()
    }

    private fun loadInitialPage(devUrlExtra: String?) {
        val fallbackUrl = DevServerConfig.buildPageUrl(START_URL, themeManager.mode, themeManager.effective())

        // If not a debug build or no explicit dev server was requested, load embedded assets immediately
        if (!BuildConfig.DEBUG || (devUrlExtra.isNullOrBlank() && !intent.getBooleanExtra("devMode", false))) {
            webView.loadUrl(fallbackUrl)
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
                if (!isFinishing && !webViewDestroyed) {
                    webView.loadUrl(finalUrl)
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

    override fun onDestroy() {
        if (!webViewDestroyed) {
            webViewDestroyed = true
            runCatching { bridge.close() }
            runCatching {
                (webView.parent as? FrameLayout)?.removeView(webView)
                webView.destroy()
            }
        }
        super.onDestroy()
    }
}
