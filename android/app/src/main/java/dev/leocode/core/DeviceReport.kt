package dev.leocode.core

import android.content.Context
import android.os.Build
import android.os.StatFs
import android.webkit.WebView

object DeviceReport {

    fun collect(context: Context, workspace: Workspace): String = buildString {
        appendLine("LeoCode Phase 0B harness")
        appendLine("device     : ${Build.MANUFACTURER} ${Build.MODEL}")
        appendLine("android    : ${Build.VERSION.RELEASE} (sdk ${Build.VERSION.SDK_INT}, patch ${Build.VERSION.SECURITY_PATCH})")
        appendLine("abis       : ${Build.SUPPORTED_ABIS.joinToString(", ")}")
        appendLine("64-bit abis: ${Build.SUPPORTED_64_BIT_ABIS.joinToString(", ")}")
        appendLine("abi (main) : ${Build.CPU_ABI}")

        val webView = runCatching { WebView.getCurrentWebViewPackage() }.getOrNull()
        appendLine("webview    : ${webView?.packageName ?: "unknown"} ${webView?.versionName ?: ""}")

        appendLine(
            "page size  : " +
                if (NativePty.available()) "${NativePty.pageSize()} bytes (native)"
                else "unknown (native lib not loaded)"
        )

        val stat = StatFs(workspace.root.absolutePath)
        val freeMb = stat.availableBytes / (1024 * 1024)
        val totalMb = stat.totalBytes / (1024 * 1024)
        appendLine("storage    : ${freeMb} MB free / ${totalMb} MB total")

        val rt = Runtime.getRuntime()
        appendLine("heap       : max ${rt.maxMemory() / (1024 * 1024)} MB")
        appendLine("workspace  : ${workspace.defaultWorkspace.absolutePath}")
        appendLine("prefix     : ${workspace.usr.absolutePath}")
        appendLine("native pty : ${if (NativePty.available()) "loaded" else "NOT loaded (JNI missing)"}")
    }
}
