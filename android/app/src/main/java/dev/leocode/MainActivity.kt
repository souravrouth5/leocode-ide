package dev.leocode

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
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
import dev.leocode.core.Workspace
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import kotlin.concurrent.thread

/**
 * The IDE shell: one full-screen WebView served from APK assets over
 * https://appassets.androidplatform.net, with the v1 bridge attached.
 *
 * The Phase 0 device harness lives in [HarnessActivity] and is still reachable:
 *   adb shell am start -n dev.leocode/.HarnessActivity --es run all
 */
class MainActivity : Activity() {

    companion object {
        private const val TAG = "LeoCode"
        private const val DOMAIN = "appassets.androidplatform.net"
        private const val ORIGIN = "https://$DOMAIN"
        private const val START_URL = "$ORIGIN/assets/web/index.html"
        const val DEV_URL_DEFAULT = "http://localhost:5173"
        const val DEV_URL_LOOPBACK = "http://127.0.0.1:5173"
    }

    private lateinit var themeManager: ThemeManager
    private lateinit var bridge: WebAppBridge
    private lateinit var webView: WebView

    private var webViewDestroyed = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        themeManager = ThemeManager(this)
        themeManager.applyToWindow()

        val workspace = Workspace(filesDir).also { it.ensure() }

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

        val bridgeEnv = workspace.childEnv()
        bridge = WebAppBridge(this, webView, workspace, themeManager, bridgeEnv, extraOrigins)

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
