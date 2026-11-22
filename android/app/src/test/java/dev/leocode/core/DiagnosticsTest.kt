package dev.leocode.core

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiagnosticsTest {

    private fun facts(
        webView: String = "com.android.chrome 137.0",
        workspaceName: String = "Workspace",
        workspaceId: String = "default",
        crash: CrashRecord? = null
    ) = Diagnostics.Facts(
        generatedAt = 1_700_000_000_000,
        appVersion = "0.1.0",
        buildKind = "debug",
        packageName = "dev.leocode",
        manufacturer = "Xiaomi",
        model = "Redmi Note 7S",
        androidRelease = "9",
        sdk = 28,
        securityPatch = "2020-02-05",
        abis = listOf("arm64-v8a"),
        webView = webView,
        pageSize = "4096 bytes (native)",
        root = "not detected",
        storageFreeMb = 9588,
        storageTotalMb = 51205,
        heapMaxMb = 256,
        workspaceName = workspaceName,
        workspaceId = workspaceId,
        runtimes = listOf(
            Diagnostics.RuntimeFact(
                id = "python",
                version = "3.14.10",
                versionCode = 31410,
                installed = true,
                healthy = true,
                installedVersionCode = 31410
            )
        ),
        lastCrash = crash
    )

    @Test
    fun `report contains the support fields`() {
        val report = Diagnostics.render(facts())

        assertTrue(report.contains("App       : LeoCode 0.1.0 (debug)"))
        assertTrue(report.contains("Device    : Xiaomi Redmi Note 7S"))
        assertTrue(report.contains("Android   : 9 (SDK 28, patch 2020-02-05)"))
        assertTrue(report.contains("Page size : 4096 bytes (native)"))
        assertTrue(report.contains("Root      : not detected"))
        assertTrue(report.contains("Workspace : Workspace (default)"))
        assertTrue(report.contains("python 3.14.10 (versionCode 31410) installed=true healthy=true"))
        assertTrue(report.contains("Last crash:\n  none"))
    }

    @Test
    fun `absolute paths and secrets are redacted`() {
        val crash = CrashRecord(
            timestamp = 1_700_000_000_000,
            thread = "main",
            exception = "java.lang.IllegalStateException",
            message = "failed at /data/data/dev.leocode/files/secret token=abc123",
            stack = "at x(/data/data/dev.leocode/files/x.kt:1)",
            appVersion = "0.1.0",
            sdk = 28,
            release = "9",
            model = "Redmi Note 7S",
            manufacturer = "Xiaomi"
        )
        val report = Diagnostics.render(
            facts(webView = "Chrome at /data/data/dev.leocode/app_webview", crash = crash)
        )

        assertFalse(report.contains("/data/"))
        assertFalse(report.contains("abc123"))
        assertTrue(report.contains("<path>"))
        assertTrue(report.contains("token=<redacted>"))
        assertTrue(report.contains("java.lang.IllegalStateException"))
    }

    @Test
    fun `no runtimes is explicit`() {
        val report = Diagnostics.render(facts().copy(runtimes = emptyList()))

        assertTrue(report.contains("Runtimes  :\n  none"))
    }
}
