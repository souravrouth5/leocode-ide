package dev.leocode

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
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
        bridge = WebAppBridge(this, webView, workspace, themeManager, bridgeEnv)

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(
                webView,
                "LeoCodeAndroid",
                setOf(ORIGIN),
                bridge
            )
            // Pass both the stored mode and the resolved theme so the page can
            // paint correctly on its first frame without clobbering "system".
            webView.loadUrl(
                "$START_URL?mode=${themeManager.mode}&theme=${themeManager.effective()}"
            )
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
