package dev.leocode

import android.content.Context
import dev.leocode.core.RuntimeInstallException
import dev.leocode.core.RuntimeInstaller
import dev.leocode.core.Workspace
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Task 25 device harness: installs the bundled Python runtime through the real
 * [RuntimeInstaller] and reports the phases, the installed tree and a live
 * `python3`/`pip3` run. Debug-only; the production path is the WebView bridge.
 */
class RuntimeHarness(
    private val context: Context,
    private val workspace: Workspace
) {

    private val installer = RuntimeInstaller(context, workspace)

    fun install(): String {
        val phases = mutableListOf<String>()
        val started = System.currentTimeMillis()
        return try {
            installer.install(
                "python",
                onProgress = { progress ->
                    if (phases.lastOrNull() != progress.phase) {
                        phases += progress.phase
                    }
                },
                isCancelled = { false }
            )
            val elapsed = (System.currentTimeMillis() - started) / 1000
            val version = run(listOf(File(workspace.usr, "bin/python3").path, "--version"))
            val pip = run(listOf(File(workspace.usr, "bin/pip3").path, "--version"))
            val marker = File(workspace.usr, ".leocode-runtime.json")
            buildString {
                appendLine("  phases: ${phases.joinToString(" -> ")}")
                appendLine("  elapsed: ${elapsed}s")
                appendLine("  marker: ${if (marker.isFile) marker.readText().trim() else "MISSING"}")
                appendLine("  python3: ${version.trim()}")
                appendLine("  pip3: ${pip.trim()}")
                appendLine("  catalog: ${installer.catalog().joinToString()}")
                append("  PASS runtime installed")
            }
        } catch (e: RuntimeInstallException) {
            "  FAIL ${e.code}: ${e.message}"
        } catch (e: Throwable) {
            "  FAIL ${e.javaClass.simpleName}: ${e.message}"
        }
    }

    fun catalog(): String = try {
        installer.catalog().joinToString("\n") {
            "  ${it.id} ${it.version} (${it.versionCode}) installed=${it.installed} " +
                "healthy=${it.healthy} recorded=${it.installedVersionCode}"
        }
    } catch (e: Throwable) {
        "  FAIL ${e.javaClass.simpleName}: ${e.message}"
    }

    fun cancel(): String {
        val cancelled = AtomicBoolean(false)
        val phases = mutableListOf<String>()
        val worker = Thread {
            try {
                installer.install(
                    "python",
                    onProgress = { phases += it.phase },
                    isCancelled = { cancelled.get() }
                )
            } catch (e: RuntimeInstallException) {
                phases += "error:${e.code}"
            } catch (e: Throwable) {
                phases += "error:${e.javaClass.simpleName}"
            }
        }.apply { isDaemon = true; start() }

        // Let the download start, then cancel mid-flight.
        Thread.sleep(2_500)
        cancelled.set(true)
        worker.join(30_000)
        val staging = File(workspace.root, "usr.staging")
        val active = File(workspace.usr, ".leocode-runtime.json")
        return buildString {
            appendLine("  phases: ${phases.joinToString(" -> ")}")
            appendLine("  staging removed: ${!staging.exists()}")
            appendLine("  runtime untouched: ${active.isFile || !workspace.usr.exists()}")
            append(
                if (phases.any { it == "error:E_CANCELLED" }) "  PASS cancelled"
                else "  FAIL no E_CANCELLED"
            )
        }
    }

    fun uninstall(): String = try {
        installer.uninstall("python")
        "  PASS uninstalled"
    } catch (e: RuntimeInstallException) {
        "  FAIL ${e.code}: ${e.message}"
    } catch (e: Throwable) {
        "  FAIL ${e.javaClass.simpleName}: ${e.message}"
    }

    private fun run(argv: List<String>): String {
        val prefix = workspace.usr
        val builder = ProcessBuilder(argv)
            .directory(prefix)
            .redirectErrorStream(true)
        val env = builder.environment()
        env.clear()
        env.putAll(
            workspace.childEnv() + mapOf(
                "PATH" to "${prefix.path}/bin:/system/bin:/system/xbin",
                "PYTHONHOME" to prefix.path,
                "LD_LIBRARY_PATH" to "${prefix.path}/lib",
                "SSL_CERT_FILE" to "${prefix.path}/etc/ca-certificates.pem",
                "TMPDIR" to workspace.tmp.path
            )
        )
        val process = builder.start()
        val output = process.inputStream.bufferedReader().use { it.readText() }
        if (!process.waitFor(30, TimeUnit.SECONDS)) {
            process.destroyForcibly()
            return "timeout"
        }
        return output
    }
}
