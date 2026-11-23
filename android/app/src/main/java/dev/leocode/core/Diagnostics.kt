package dev.leocode.core

import android.content.Context
import android.os.Build
import android.os.StatFs
import android.webkit.WebView
import dev.leocode.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Support report for Settings › About › Diagnostics (Task 27).
 *
 * The report is assembled from fields the app already knows, then passed through
 * [Redactor] as a whole. That is deliberate: a path or token that slips into a
 * new field still cannot leave the device. The report is plain text, so Copy
 * needs nothing else; Share hands it to `app.share` and the system chooser.
 */
object Diagnostics {

    /** One installed (or catalog) runtime, kept local so `core` stays bridge-free. */
    data class RuntimeFact(
        val id: String,
        val version: String,
        val versionCode: Int,
        val installed: Boolean,
        val healthy: Boolean,
        val installedVersionCode: Int?
    )

    /** Everything the report needs; [collect] fills it from Android. */
    data class Facts(
        val generatedAt: Long,
        val appVersion: String,
        val buildKind: String,
        val packageName: String,
        val manufacturer: String,
        val model: String,
        val androidRelease: String,
        val sdk: Int,
        val securityPatch: String,
        val abis: List<String>,
        val webView: String,
        val pageSize: String,
        val root: String,
        val storageFreeMb: Long,
        val storageTotalMb: Long,
        val heapMaxMb: Long,
        val workspaceName: String,
        val workspaceId: String,
        val runtimes: List<RuntimeFact>,
        val lastCrash: CrashRecord?
    )

    fun collect(
        context: Context,
        workspace: Workspace,
        workspaceId: String,
        workspaceName: String,
        runtimes: List<RuntimeFact>,
        lastCrash: CrashRecord?,
        rootStatus: String? = null
    ): String {
        val webView = runCatching { WebView.getCurrentWebViewPackage() }.getOrNull()
        val stat = StatFs(workspace.root.absolutePath)
        return render(
            Facts(
                generatedAt = System.currentTimeMillis(),
                appVersion = BuildConfig.VERSION_NAME,
                buildKind = if (BuildConfig.DEBUG) "debug" else "release",
                packageName = context.packageName,
                manufacturer = Build.MANUFACTURER,
                model = Build.MODEL,
                androidRelease = Build.VERSION.RELEASE,
                sdk = Build.VERSION.SDK_INT,
                securityPatch = Build.VERSION.SECURITY_PATCH,
                abis = Build.SUPPORTED_ABIS.toList(),
                webView = "${webView?.packageName ?: "unknown"} ${webView?.versionName ?: ""}",
                pageSize = if (NativePty.available()) {
                    "${NativePty.pageSize()} bytes (native)"
                } else {
                    "unknown (native lib not loaded)"
                },
                root = rootStatus ?: rootStatus(),
                storageFreeMb = stat.availableBytes / MB,
                storageTotalMb = stat.totalBytes / MB,
                heapMaxMb = Runtime.getRuntime().maxMemory() / MB,
                workspaceName = workspaceName,
                workspaceId = workspaceId,
                runtimes = runtimes,
                lastCrash = lastCrash
            )
        )
    }

    /** Pure formatter, so unit tests can cover every field and the redaction. */
    fun render(facts: Facts): String {
        val raw = buildString {
            appendLine("LeoCode diagnostics")
            appendLine("Generated : ${timestamp(facts.generatedAt)}")
            appendLine("App       : LeoCode ${facts.appVersion} (${facts.buildKind})")
            appendLine("Package   : ${facts.packageName}")
            appendLine("Device    : ${facts.manufacturer} ${facts.model}")
            appendLine(
                "Android   : ${facts.androidRelease} " +
                    "(SDK ${facts.sdk}, patch ${facts.securityPatch})"
            )
            appendLine("ABIs      : ${facts.abis.joinToString(", ")}")
            appendLine("WebView   : ${facts.webView}")
            appendLine("Page size : ${facts.pageSize}")
            appendLine("Root      : ${facts.root}")
            appendLine(
                "Storage   : ${facts.storageFreeMb} MB free / " +
                    "${facts.storageTotalMb} MB total"
            )
            appendLine("Heap max  : ${facts.heapMaxMb} MB")
            appendLine("Workspace : ${facts.workspaceName} (${facts.workspaceId})")

            appendLine("Runtimes  :")
            if (facts.runtimes.isEmpty()) {
                appendLine("  none")
            } else {
                for (runtime in facts.runtimes) {
                    appendLine(
                        "  ${runtime.id} ${runtime.version} " +
                            "(versionCode ${runtime.installedVersionCode ?: runtime.versionCode}) " +
                            "installed=${runtime.installed} healthy=${runtime.healthy}"
                    )
                }
            }

            appendLine("Last crash:")
            val crash = facts.lastCrash
            if (crash == null) {
                appendLine("  none")
            } else {
                appendLine("  ${timestamp(crash.timestamp)} ${crash.exception}")
                if (crash.message.isNotBlank()) {
                    appendLine("  ${crash.message.lineSequence().first()}")
                }
            }
        }
        return Redactor.redact(raw)
    }

    /**
     * Root is inferred without running `su`: an actual invocation can block on a
     * permission prompt or a manager UI. A su binary or test-keys build is enough
     * to tell support that root may be involved.
     */
    private fun rootStatus(): String {
        val suPaths = listOf(
            "/system/bin/su",
            "/system/xbin/su",
            "/sbin/su",
            "/su/bin/su",
            "/data/adb/magisk"
        )
        val present = suPaths.count { runCatching { File(it).exists() }.getOrDefault(false) }
        val testKeys = (Build.TAGS ?: "").contains("test-keys")
        return when {
            present > 0 && testKeys -> "su binary present; test-keys build"
            present > 0 -> "su binary present"
            testKeys -> "test-keys build"
            else -> "not detected"
        }
    }

    private fun timestamp(millis: Long): String =
        SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.US).format(Date(millis))

    private const val MB = 1024L * 1024L
}
