package dev.leocode

import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import dev.leocode.bridge.BridgeRouter
import dev.leocode.bridge.ThemePort
import dev.leocode.core.PathJail
import dev.leocode.core.ProcessHost
import dev.leocode.core.PtySession
import dev.leocode.core.RuntimeInstallException
import dev.leocode.core.RuntimeInstaller
import dev.leocode.core.Workspace
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.io.InputStream
import java.io.InputStreamReader
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * v1 bridge, `docs/bridge-contract.md`.
 *
 * Transport is `WebViewCompat.addWebMessageListener` on the appassets origin only.
 * Every request gets exactly one ok/err reply; long operations stream events keyed
 * by the request id.
 *
 * Security: every path is canonicalised and jailed by [PathJail] inside the
 * workspace roots, plus shared storage only while its permission is granted.
 * Secrets never cross this boundary.
 */
class WebAppBridge(
    private val activity: MainActivity,
    private val webView: WebView,
    private val workspace: Workspace,
    private val themePort: ThemePort,
    private val env: Map<String, String>,
    private val jail: PathJail,
    private val extraAllowedOrigins: Set<String> = emptySet(),
    private val router: BridgeRouter
) : WebViewCompat.WebMessageListener {

    companion object {
        private const val TAG = "LeoCodeBridge"
        private const val MAX_WRITE_BYTES = 4 * 1024 * 1024
        private const val MAX_MESSAGE_BYTES = 256 * 1024
        private const val MAX_EVENT_BYTES = 64 * 1024

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

    private val sessions = ConcurrentHashMap<String, PtySession>()
    private val jobs = ConcurrentHashMap<String, Process>()
    private val runtimeJobs = ConcurrentHashMap<String, AtomicBoolean>()

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

        val root = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull()
        if (root == null) {
            sendError(replyProxy, null, "E_BAD_ENVELOPE", "message is not a JSON object")
            return
        }

        io.execute {
            handle(root, replyProxy)
        }
    }

    // ------------------------------------------------------------------ dispatch

    private fun handle(request: JsonObject, proxy: JavaScriptReplyProxy) {
        val id = request.str("id")
        val method = request.str("method")
        val payload = (request["payload"] as? JsonObject) ?: JsonObject(emptyMap())

        if (method == null) {
            sendError(proxy, id, "E_BAD_ENVELOPE", "method is required")
            return
        }

        // Task 5: app.* and fs.* are served by the typed router. It returns the
        // complete reply (including v/id/ok/error) and never throws.
        if (router.handles(method)) {
            post(proxy, router.dispatch(request))
            return
        }

        try {
            val result = when (method) {
                "storage.info" -> storageInfo()
                "storage.requestPermission" -> {
                    requestStoragePermission(proxy, id)
                    return
                }
                "saf.open" -> {
                    openSaf(proxy, id)
                    return
                }
                "saf.save" -> {
                    saveSaf(payload, proxy, id)
                    return
                }
                "proc.run" -> runProcess(payload, proxy, id)
                "proc.cancel" -> cancelProcess(payload)
                "runtime.install" -> {
                    installRuntime(payload, proxy, id)
                    return
                }
                "runtime.cancel" -> cancelRuntime(payload)
                "term.open" -> openTerminal(payload, proxy, id)
                "term.write" -> writeTerminal(payload)
                "term.resize" -> resizeTerminal(payload)
                "term.close" -> closeTerminal(payload)
                else -> throw BridgeError("E_UNKNOWN_METHOD", "unknown method: $method")
            }
            sendOk(proxy, id, result)
        } catch (e: BridgeError) {
            Log.w(TAG, "$method failed with BridgeError: ${e.code}: ${e.message}")
            sendError(proxy, id, e.code, e.message)
        } catch (e: Throwable) {
            Log.w(TAG, "$method failed", e)
            sendError(proxy, id, "E_INTERNAL", e.message ?: e.javaClass.simpleName)
        }
    }

    // ------------------------------------------------------------------- methods

    private fun runProcess(payload: JsonObject, proxy: JavaScriptReplyProxy, id: String?): JsonObject {
        val argv = (payload["argv"] as? JsonArray)
            ?.mapNotNull { it.jsonPrimitive.contentOrNull }
            ?: throw BridgeError("E_BAD_ENVELOPE", "argv is required")
        if (argv.isEmpty()) throw BridgeError("E_BAD_ENVELOPE", "argv is empty")

        val cwd = resolve(payload, "cwd")
        if (!cwd.isDirectory) throw BridgeError("E_NOT_DIR", "cwd is not a directory")

        // Run in a fresh session so proc.cancel can signal the whole process
        // group; a shell script's children would otherwise outlive SIGTERM.
        val command = if (File("/system/bin/setsid").canExecute()) {
            listOf("/system/bin/setsid") + argv
        } else {
            argv
        }

        val builder = ProcessBuilder(command).directory(cwd)
        val childEnv = builder.environment()
        childEnv.clear()
        childEnv.putAll(env)
        (payload["env"] as? JsonObject)?.forEach { (key, value) ->
            value.jsonPrimitive.contentOrNull?.let { childEnv[key] = it }
        }

        val process = try {
            builder.start()
        } catch (e: Exception) {
            throw BridgeError("E_IO", "cannot start ${argv.first()}: ${e.message}")
        }

        val jobId = UUID.randomUUID().toString()
        jobs[jobId] = process

        thread(isDaemon = true, name = "proc-out-$jobId") {
            pumpText(process.inputStream, "proc.stdout", id, proxy)
        }
        thread(isDaemon = true, name = "proc-err-$jobId") {
            pumpText(process.errorStream, "proc.stderr", id, proxy)
        }
        thread(isDaemon = true, name = "proc-wait-$jobId") {
            val code = runCatching { process.waitFor() }.getOrDefault(-1)
            jobs.remove(jobId)
            sendEvent(proxy, id, "proc.exit", buildJsonObject { put("code", code) })
        }

        return buildJsonObject {
            put("jobId", jobId)
            put("pid", ProcessHost.pidOf(process))
        }
    }

    private fun cancelProcess(payload: JsonObject): JsonObject {
        val jobId = payload.str("jobId") ?: throw BridgeError("E_BAD_ENVELOPE", "jobId is required")
        val process = jobs.remove(jobId) ?: return buildJsonObject { put("cancelled", false) }
        val pid = ProcessHost.pidOf(process)
        if (pid > 0) {
            dev.leocode.core.NativePty.killGroup(pid, 15)
            dev.leocode.core.NativePty.killGroup(pid, 9)
        }
        runCatching { process.destroy() }
        runCatching { process.destroyForcibly() }
        return buildJsonObject { put("cancelled", true) }
    }

    private fun installRuntime(payload: JsonObject, proxy: JavaScriptReplyProxy, id: String?) {
        val runtimeId = payload.str("id")
            ?: throw BridgeError("E_BAD_ENVELOPE", "id is required")
        val cancelled = AtomicBoolean(false)
        if (runtimeJobs.putIfAbsent(runtimeId, cancelled) != null) {
            throw BridgeError("E_BUSY", "$runtimeId is already being installed")
        }

        try {
            RuntimeInstaller(activity.applicationContext, workspace).install(
                runtimeId,
                onProgress = { progress ->
                    sendEvent(
                        proxy,
                        id,
                        "runtime.progress",
                        buildJsonObject {
                            put("phase", progress.phase)
                            put("bytes", progress.bytes)
                            put("total", progress.total)
                            put("message", progress.message)
                        }
                    )
                },
                isCancelled = { cancelled.get() }
            )
            sendOk(
                proxy,
                id,
                buildJsonObject {
                    put("id", runtimeId)
                    put("installed", true)
                }
            )
        } catch (e: RuntimeInstallException) {
            Log.w(TAG, "runtime.install($runtimeId) failed: ${e.code}: ${e.message}")
            sendError(proxy, id, e.code, e.message)
        } finally {
            runtimeJobs.remove(runtimeId)
        }
    }

    private fun cancelRuntime(payload: JsonObject): JsonObject {
        val runtimeId = payload.str("id")
            ?: throw BridgeError("E_BAD_ENVELOPE", "id is required")
        val flag = runtimeJobs[runtimeId]
        flag?.set(true)
        return buildJsonObject { put("cancelling", flag != null) }
    }

    private fun openTerminal(payload: JsonObject, proxy: JavaScriptReplyProxy, id: String?): JsonObject {
        val cwd = resolve(payload, "cwd")
        if (!cwd.isDirectory) throw BridgeError("E_NOT_DIR", "cwd is not a directory")
        val cols = payload.int("cols") ?: 80
        val rows = payload.int("rows") ?: 24

        val session = PtySession.openShell(cwd.absolutePath, env, rows, cols)
            ?: throw BridgeError("E_NO_RUNTIME", "native PTY is not available")

        val sessionId = UUID.randomUUID().toString()
        sessions[sessionId] = session

        // Events are keyed by the *request* id so the web can register its handler
        // before any output exists (the shell prompt is emitted immediately).
        val eventKey = id ?: sessionId
        thread(isDaemon = true, name = "pty-$sessionId") {
            pumpSession(session, sessionId, eventKey, proxy)
        }

        return buildJsonObject {
            put("sessionId", sessionId)
            put("pid", session.pid)
        }
    }

    private fun writeTerminal(payload: JsonObject): JsonObject {
        val sessionId = payload.str("sessionId") ?: throw BridgeError("E_BAD_ENVELOPE", "sessionId is required")
        val session = sessions[sessionId] ?: throw BridgeError("E_NOT_FOUND", "no such session")
        val bytes = try {
            Base64.decode(payload.str("b64") ?: "", Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            throw BridgeError("E_BAD_ENVELOPE", "invalid base64")
        }
        if (bytes.isNotEmpty()) session.write(bytes)
        return buildJsonObject { put("accepted", bytes.size) }
    }

    private fun resizeTerminal(payload: JsonObject): JsonObject {
        val sessionId = payload.str("sessionId") ?: throw BridgeError("E_BAD_ENVELOPE", "sessionId is required")
        val session = sessions[sessionId] ?: throw BridgeError("E_NOT_FOUND", "no such session")
        session.resize(payload.int("rows") ?: 24, payload.int("cols") ?: 80)
        return buildJsonObject { put("ok", true) }
    }

    private fun closeTerminal(payload: JsonObject): JsonObject {
        val sessionId = payload.str("sessionId") ?: throw BridgeError("E_BAD_ENVELOPE", "sessionId is required")
        val session = sessions.remove(sessionId)
        session?.destroy()
        return buildJsonObject { put("closed", session != null) }
    }

    // -------------------------------------------------------------------- streams

    private fun pumpText(stream: InputStream, event: String, id: String?, proxy: JavaScriptReplyProxy) {
        val reader = InputStreamReader(stream, Charsets.UTF_8)
        val buffer = CharArray(8 * 1024)
        try {
            while (true) {
                val read = try {
                    reader.read(buffer)
                } catch (e: Throwable) {
                    break
                }
                if (read < 0) break
                if (read == 0) continue
                val text = String(buffer, 0, read)
                sendEvent(proxy, id, event, buildJsonObject { put("data", text.take(MAX_EVENT_BYTES)) })
            }
        } finally {
            runCatching { reader.close() }
        }
    }

    private fun pumpSession(
        session: PtySession,
        sessionId: String,
        eventKey: String,
        proxy: JavaScriptReplyProxy
    ) {
        try {
            while (true) {
                val chunk = session.readBlocking() ?: break
                if (chunk.isEmpty()) continue
                sendEvent(
                    proxy,
                    eventKey,
                    "term.data",
                    buildJsonObject { put("b64", Base64.encodeToString(chunk, Base64.NO_WRAP)) }
                )
            }
        } catch (e: Throwable) {
            Log.d(TAG, "pty read ended: ${e.message}")
        } finally {
            val code = runCatching { session.waitFor() }.getOrDefault(-1)
            sessions.remove(sessionId)
            runCatching { session.destroy() }
            sendEvent(proxy, eventKey, "term.exit", buildJsonObject { put("code", code) })
        }
    }

    // ------------------------------------------------------------------- helpers

    fun pushTheme() {
        val payload = themePort.state().toString()
        webView.post {
            webView.evaluateJavascript(
                "window.__leocodeThemeEvent && window.__leocodeThemeEvent($payload)",
                null
            )
        }
    }

    fun close() {
        sessions.keys.toList().forEach { id ->
            sessions.remove(id)?.destroy()
        }
        jobs.keys.toList().forEach { id ->
            jobs.remove(id)?.let { p ->
                runCatching { p.destroyForcibly() }
            }
        }
        io.shutdownNow()
    }

    private fun storageInfo(): JsonObject {
        val hasPerm = activity.checkStoragePermission()
        val extStorage = Environment.getExternalStorageDirectory().absolutePath
        val downloads = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS).absolutePath
        val documents = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).absolutePath

        return buildJsonObject {
            put("hasPermission", hasPerm)
            put("internalStorage", extStorage)
            put("downloads", downloads)
            put("documents", documents)
            put("workspace", workspace.defaultWorkspace.absolutePath)
        }
    }

    private fun requestStoragePermission(proxy: JavaScriptReplyProxy, id: String?) {
        activity.runOnUiThread {
            activity.requestStoragePermission { granted ->
                sendOk(
                    proxy,
                    id,
                    buildJsonObject {
                        put("granted", granted)
                    }
                )
            }
        }
    }

    private fun openSaf(proxy: JavaScriptReplyProxy, id: String?) {
        activity.runOnUiThread {
            activity.openSafDocument { uri ->
                if (uri == null) {
                    sendOk(proxy, id, JsonNull)
                    return@openSafDocument
                }
                io.execute {
                    val name = activity.queryUriFileName(uri)
                    val content = activity.readUriContent(uri)
                    if (content.toByteArray(Charsets.UTF_8).size > MAX_WRITE_BYTES) {
                        sendError(proxy, id, "E_LIMIT", "file is larger than 4 MB")
                        return@execute
                    }
                    sendOk(
                        proxy,
                        id,
                        buildJsonObject {
                            put("name", name)
                            put("uri", uri.toString())
                            put("content", content)
                            put("size", content.toByteArray(Charsets.UTF_8).size)
                        }
                    )
                }
            }
        }
    }

    private fun saveSaf(payload: JsonObject, proxy: JavaScriptReplyProxy, id: String?) {
        val filename = payload.str("name") ?: "document.txt"
        val content = payload.str("content") ?: ""
        if (content.toByteArray(Charsets.UTF_8).size > MAX_WRITE_BYTES) {
            throw BridgeError("E_LIMIT", "content is larger than 4 MB")
        }
        activity.runOnUiThread {
            activity.saveSafDocument(filename, content) { uri ->
                if (uri == null) {
                    sendOk(proxy, id, JsonNull)
                    return@saveSafDocument
                }
                sendOk(
                    proxy,
                    id,
                    buildJsonObject {
                        put("name", filename)
                        put("uri", uri.toString())
                    }
                )
            }
        }
    }

    private fun resolve(payload: JsonObject, key: String): File {
        val raw = payload.str(key) ?: if (key == "path" || key == "cwd") "." else
            throw BridgeError("E_BAD_ENVELOPE", "$key is required")

        return try {
            jail.resolve(raw, workspace.defaultWorkspace)
        } catch (e: SecurityException) {
            throw BridgeError("E_PATH_OUTSIDE_ROOT", "path is outside the allowed roots")
        }
    }

    private fun sendOk(proxy: JavaScriptReplyProxy, id: String?, payload: JsonElement) {
        post(
            proxy,
            buildJsonObject {
                put("v", 1)
                put("id", idElement(id))
                put("ok", true)
                put("payload", payload)
            }
        )
    }

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

    private fun JsonObject.int(key: String): Int? =
        this[key]?.jsonPrimitive?.intOrNull
}

class BridgeError(val code: String, override val message: String) : Exception(message)
