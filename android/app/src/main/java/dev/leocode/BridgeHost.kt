package dev.leocode

import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import dev.leocode.bridge.BridgeRouter
import dev.leocode.bridge.EventSink
import dev.leocode.bridge.StreamSink
import dev.leocode.bridge.ThemePort
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.Executors

/**
 * WebView transport for the typed bridge, `docs/bridge-contract.md`.
 *
 * Origin check, size cap, envelope parsing and reply posting live here; every
 * method is served by a [BridgeRouter] handler. Requests run off the main
 * thread so a handler can block on IO, and every request gets exactly one reply
 * even when the answer arrives later (`saf.*`, `runtime.install`).
 */
class BridgeHost(
    private val webView: WebView,
    private val themePort: ThemePort,
    private val extraAllowedOrigins: Set<String> = emptySet(),
    private val router: BridgeRouter,
    private val onClose: () -> Unit = {}
) : WebViewCompat.WebMessageListener {

    companion object {
        private const val TAG = "LeoCodeBridge"
        private const val MAX_MESSAGE_BYTES = 256 * 1024

        fun isOriginAllowed(
            scheme: String?,
            host: String?,
            port: Int = -1,
            authority: String? = null,
            isDebug: Boolean = BuildConfig.DEBUG,
            extraOrigins: Set<String> = emptySet()
        ): Boolean {
            if (scheme == "https" && host == "appassets.androidplatform.net") {
                return true
            }
            if (isDebug) {
                if (scheme == "http" && (host == "localhost" || host == "127.0.0.1") && (port == 5173 || port == -1)) {
                    return true
                }
                val auth = authority ?: (if (port != -1 && host != null) "$host:$port" else host)
                val originStr = if (auth != null) "$scheme://$auth".trimEnd('/') else ""
                if (originStr == "http://localhost:5173" || originStr == "http://127.0.0.1:5173") {
                    return true
                }
                if (extraOrigins.any { extra ->
                    originStr.equals(extra.trimEnd('/'), ignoreCase = true)
                }) {
                    return true
                }
            }
            return false
        }

        fun isOriginAllowed(
            sourceOrigin: Uri,
            isDebug: Boolean = BuildConfig.DEBUG,
            extraOrigins: Set<String> = emptySet()
        ): Boolean {
            val scheme = runCatching { sourceOrigin.scheme }.getOrNull()
            val host = runCatching { sourceOrigin.host }.getOrNull()
            val port = runCatching { sourceOrigin.port }.getOrDefault(-1)
            val auth = runCatching { sourceOrigin.encodedAuthority }.getOrNull()
            return isOriginAllowed(scheme, host, port, auth, isDebug, extraOrigins)
        }

        fun isOriginAllowed(
            originUrl: String,
            isDebug: Boolean = BuildConfig.DEBUG,
            extraOrigins: Set<String> = emptySet()
        ): Boolean {
            return try {
                val uri = java.net.URI(originUrl)
                isOriginAllowed(
                    scheme = uri.scheme,
                    host = uri.host,
                    port = uri.port,
                    authority = uri.authority,
                    isDebug = isDebug,
                    extraOrigins = extraOrigins
                )
            } catch (_: Exception) {
                false
            }
        }
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "leocode-bridge").apply { isDaemon = true }
    }

    // ------------------------------------------------------------ WebMessageListener

    override fun onPostMessage(
        webView: WebView,
        message: WebMessageCompat,
        sourceOrigin: Uri,
        isMainFrame: Boolean,
        replyProxy: JavaScriptReplyProxy
    ) {
        if (!isMainFrame) return
        if (!isOriginAllowed(sourceOrigin, BuildConfig.DEBUG, extraAllowedOrigins)) {
            Log.w(TAG, "rejected message from foreign origin $sourceOrigin")
            return
        }
        val raw = message.data ?: return
        if (raw.length > MAX_MESSAGE_BYTES ||
            raw.toByteArray(Charsets.UTF_8).size > MAX_MESSAGE_BYTES
        ) {
            sendError(replyProxy, null, "E_LIMIT", "message is larger than 256 KB")
            return
        }

        val request = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
        if (request == null) {
            sendError(replyProxy, null, "E_BAD_ENVELOPE", "message is not a JSON object")
            return
        }

        val id = request.str("id")
        io.execute {
            router.dispatchAsync(request, WebViewStreamSink(replyProxy, id)) { reply ->
                post(replyProxy, reply)
            }
        }
    }

    /** Re-applies the current theme after a page load. */
    fun pushTheme() {
        val payload = themePort.state().toString()
        webView.post {
            webView.evaluateJavascript(
                "window.__leocodeThemeEvent && window.__leocodeThemeEvent($payload)",
                null
            )
        }
    }

    /** Stop the transport; [onClose] tears down sessions and jobs. */
    fun close() {
        runCatching { onClose() }
        io.shutdownNow()
    }

    // -------------------------------------------------------------------- streams

    /** One sink per request; coalesces text/bytes and posts events on the main thread. */
    private inner class WebViewStreamSink(
        private val proxy: JavaScriptReplyProxy,
        private val id: String?
    ) : StreamSink {
        private val coalescer = EventSink(post = { event, payload -> sendEvent(proxy, id, event, payload) })

        override fun event(name: String, payload: JsonElement) {
            coalescer.flush()
            sendEvent(proxy, id, name, payload)
        }

        override fun text(name: String, text: String) {
            coalescer.text(name, text)
        }

        override fun bytes(name: String, bytes: ByteArray) {
            coalescer.bytes(name, bytes)
        }
    }

    // ------------------------------------------------------------------- replies

    private fun sendError(proxy: JavaScriptReplyProxy, id: String?, code: String, message: String) {
        post(
            proxy,
            buildJsonObject {
                put("v", 1)
                put("id", idElement(id))
                put("ok", false)
                put(
                    "error",
                    buildJsonObject {
                        put("code", code)
                        put("message", message)
                    }
                )
            }
        )
    }

    private fun sendEvent(proxy: JavaScriptReplyProxy, id: String?, event: String, payload: JsonElement) {
        post(
            proxy,
            buildJsonObject {
                put("v", 1)
                put("id", idElement(id))
                put("event", event)
                put("payload", payload)
            }
        )
    }

    private fun post(proxy: JavaScriptReplyProxy, message: JsonObject) {
        val text = message.toString()
        main.post {
            try {
                proxy.postMessage(text)
            } catch (e: Throwable) {
                Log.d(TAG, "reply dropped: ${e.message}")
            }
        }
    }

    private fun idElement(id: String?): JsonElement =
        if (id == null) JsonNull else JsonPrimitive(id)

    private fun JsonObject.str(key: String): String? =
        this[key]?.jsonPrimitive?.contentOrNull
}
