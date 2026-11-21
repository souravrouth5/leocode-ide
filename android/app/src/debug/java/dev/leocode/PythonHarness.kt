package dev.leocode

import dev.leocode.core.PythonProject
import dev.leocode.core.PythonProjectException
import dev.leocode.core.Workspace
import java.io.File
import java.nio.file.Files

/**
 * Task 26 device harness: the full Python workflow through the production
 * [PythonProject].
 *
 * Optional extras:
 *   --es proxy http://127.0.0.1:18080   forwarded to pip/requests
 *   --es wheel /path/to/markupsafe.whl  install this Android wheel
 *
 * Debug-only; the production path is the WebView bridge and the Run action.
 */
class PythonHarness(
    private val workspace: Workspace,
    private val proxy: String? = null,
    private val wheel: String? = null
) {

    fun run(): String {
        val project = File(workspace.tmp, "t15-project")
        deleteTree(project)
        if (!project.mkdirs()) return "  FAIL cannot create ${project.absolutePath}"

        File(project, "requirements.txt").writeText("requests\n")
        File(project, "fetch.py").writeText(
            """
            import sys
            import requests
            import markupsafe

            print("python", sys.version.split()[0])
            print("requests", requests.__version__)
            print("markupsafe", markupsafe.escape("<b>"))
            response = requests.get("https://example.com", timeout=30)
            print("fetch", response.status_code, len(response.content))
            """.trimIndent() + "\n"
        )

        val extra = if (proxy.isNullOrBlank()) {
            emptyMap()
        } else {
            mapOf(
                "http_proxy" to proxy,
                "https_proxy" to proxy,
                "no_proxy" to ""
            )
        }
        val python = PythonProject(workspace, project, extra)
        val checks = mutableListOf<String>()
        return try {
            val status = python.createVenv()
            checks += "venv: ${status.venvPython ?: "missing"}"
            checks += "pyvenv.cfg: " + File(status.venvPath, "pyvenv.cfg")
                .takeIf { it.isFile }?.readText()?.trim()?.replace("\n", " | ")

            val aliases = python.ensureAliases()
            checks += "aliases: python=${File(workspace.usr, "bin/python").exists()} " +
                "pip=${File(workspace.usr, "bin/pip").exists()}"

            val pip = python.runPython(listOf("-m", "pip", "--version"))
            checks += "pip: ${pip.output.trim().take(160)}"

            val requirements = python.runRequirements { }
            checks += "requirements: exit=${requirements.exit} " +
                requirements.output.trim().lines().lastOrNull().orEmpty().take(200)

            if (!wheel.isNullOrBlank()) {
                val installed = python.pip(listOf("install", "--disable-pip-version-check", wheel))
                checks += "wheel: exit=${installed.exit} " +
                    installed.output.trim().lines().lastOrNull().orEmpty().take(200)
            } else {
                checks += "wheel: not provided (markupsafe from PyPI has no Android wheel)"
            }

            val run = python.runPython(listOf("fetch.py"))
            checks += "script: exit=${run.exit}"
            checks += run.output.trim().lines().take(8).joinToString("\n           ")

            val pass = aliases &&
                pip.exit == 0 &&
                requirements.exit == 0 &&
                (wheel.isNullOrBlank() || run.output.contains("markupsafe &lt;b&gt;")) &&
                run.exit == 0 &&
                run.output.contains("fetch 200")

            buildString {
                checks.forEach { appendLine("  $it") }
                append(if (pass) "  PASS venv + requests + markupsafe + fetch" else "  FAIL")
            }
        } catch (e: PythonProjectException) {
            buildString {
                checks.forEach { appendLine("  $it") }
                append("  FAIL ${e.code}: ${e.message}")
            }
        } catch (e: Throwable) {
            buildString {
                checks.forEach { appendLine("  $it") }
                append("  FAIL ${e.javaClass.simpleName}: ${e.message}")
            }
        }
    }

    private fun deleteTree(file: File) {
        if (Files.isSymbolicLink(file.toPath())) {
            Files.deleteIfExists(file.toPath())
            return
        }
        if (file.isDirectory) file.listFiles().orEmpty().forEach(::deleteTree)
        Files.deleteIfExists(file.toPath())
    }
}
