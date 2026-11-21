package dev.leocode.core

import java.io.File
import java.nio.file.Files
import java.util.concurrent.TimeUnit

/** A failure with a bridge error code (Task 26). */
class PythonProjectException(val code: String, message: String) : Exception(message)

/** What the app knows about a project's Python environment. */
data class PythonStatus(
    val runtimeInstalled: Boolean,
    val runtimePython: String?,
    val venvExists: Boolean,
    val venvPath: String,
    val venvPython: String?,
    val requirementsExists: Boolean,
    val requirementsPath: String?,
    val requirementsHash: String?,
    val requirementsInstalled: Boolean,
    val aliasesReady: Boolean
)

/**
 * Per-project Python integration (Task 26).
 *
 * A project uses `<project>/.venv` when it exists; otherwise the bundled runtime
 * is the interpreter. Nothing is created implicitly here: the UI asks for trust
 * first and then calls [createVenv] / [runRequirements]. Requirements are
 * considered installed only while the recorded hash still matches the file.
 */
class PythonProject(
    private val workspace: Workspace,
    private val projectDir: File,
    /** Extra allowlisted variables (the debug harness passes a proxy). */
    private val extraEnv: Map<String, String> = emptyMap()
) {

    val project: File = projectDir.canonicalFile
    val venv: File = File(project, VENV_DIR)
    val venvPython: File = File(venv, "bin/python")
    val runtimePython: File = File(workspace.usr, "bin/python3")
    val requirements: File = File(project, "requirements.txt")
    private val marker: File = File(venv, MARKER)

    fun status(): PythonStatus {
        val hash = requirementsHash()
        return PythonStatus(
            runtimeInstalled = runtimePython.isFile && runtimePython.canExecute(),
            runtimePython = runtimePython.takeIf { it.isFile }?.absolutePath,
            venvExists = venvPython.isFile,
            venvPath = venv.absolutePath,
            venvPython = venvPython.takeIf { it.isFile }?.absolutePath,
            requirementsExists = requirements.isFile,
            requirementsPath = requirements.takeIf { it.isFile }?.absolutePath,
            requirementsHash = hash,
            requirementsInstalled = hash != null && marker.isFile &&
                marker.readText().trim() == hash,
            aliasesReady = File(workspace.usr, "bin/python").exists() &&
                File(workspace.usr, "bin/pip").exists()
        )
    }

    /** `python` and `pip` aliases in the runtime prefix, for the terminal (Task 26). */
    fun ensureAliases(): Boolean = ensureAliases(File(workspace.usr, "bin"))

    /**
     * Creates `.venv` with the bundled runtime. Idempotent: an existing healthy
     * venv is returned unchanged, while an incomplete one is removed first.
     */
    fun createVenv(): PythonStatus {
        ensureAliases()
        if (!runtimePython.isFile || !runtimePython.canExecute()) {
            throw PythonProjectException("E_NO_RUNTIME", "Python is not installed")
        }
        if (venvPython.isFile) return status()
        if (venv.exists()) deleteTree(venv)

        val result = run(
            argv = listOf(runtimePython.absolutePath, "-m", "venv", VENV_DIR),
            cwd = project,
            environment = environment(useVenv = false),
            timeoutMs = 180_000
        )
        if (result.exit != 0 || !venvPython.isFile) {
            throw PythonProjectException(
                "E_IO",
                "the Python environment could not be created: " +
                    result.output.takeLast(600).trim()
            )
        }
        return status()
    }

    /** Removes the project venv; the runtime and project files are untouched. */
    fun removeVenv() {
        val target = venv.canonicalFile
        val root = project.canonicalFile
        if (target != root && !target.path.startsWith(root.path + File.separator)) {
            throw PythonProjectException("E_PERMISSION", "the environment is outside the project")
        }
        if (target.exists()) deleteTree(target)
    }

    /**
     * Runs `pip install -r requirements.txt` in the project venv and records the
     * requirements hash on success. Output lines are forwarded for the UI.
     */
    fun runRequirements(onLine: (String) -> Unit): PythonProcessResult {
        if (!venvPython.isFile) {
            throw PythonProjectException("E_NOT_FOUND", "create the Python environment first")
        }
        if (!requirements.isFile) {
            throw PythonProjectException("E_NOT_FOUND", "this project has no requirements.txt")
        }
        val hash = requirementsHash()
            ?: throw PythonProjectException("E_IO", "cannot read requirements.txt")
        val result = pip(
            listOf("install", "--disable-pip-version-check", "-r", requirements.absolutePath),
            onLine
        )
        if (result.exit == 0) markRequirementsInstalled(hash)
        return result
    }

    /** Runs pip from the project venv (the caller has already checked trust). */
    fun pip(args: List<String>, onLine: (String) -> Unit = {}): PythonProcessResult {
        if (!venvPython.isFile) {
            throw PythonProjectException("E_NOT_FOUND", "create the Python environment first")
        }
        return run(
            argv = listOf(venvPython.absolutePath, "-m", "pip") + args,
            cwd = project,
            environment = environment(useVenv = true),
            timeoutMs = 15 * 60_000,
            onLine = onLine
        )
    }

    /** Runs the project interpreter (venv when present) with [args]. */
    fun runPython(args: List<String>, onLine: (String) -> Unit = {}): PythonProcessResult =
        run(
            argv = listOf(interpreter().absolutePath) + args,
            cwd = project,
            environment = environment(useVenv = venvPython.isFile),
            timeoutMs = 15 * 60_000,
            onLine = onLine
        )

    fun requirementsHash(): String? =
        if (!requirements.isFile) null
        else runCatching {
            TrustFingerprint.compute(project, TrustAction.PIP)
        }.getOrNull()

    fun markRequirementsInstalled(hash: String) {
        marker.parentFile?.mkdirs()
        AtomicWriter.write(marker, (hash + "\n").toByteArray())
    }

    /** Environment for scripts run with the project venv (the UI passes this to `proc.run`). */
    fun venvEnv(): Map<String, String> = environment(useVenv = true)

    fun interpreter(): File = if (venvPython.isFile) venvPython else runtimePython

    private fun environment(useVenv: Boolean): Map<String, String> {
        val bin = if (useVenv) File(venv, "bin") else File(workspace.usr, "bin")
        return workspace.childEnv() + mapOf(
            "PATH" to listOf(
                bin.absolutePath,
                File(workspace.usr, "bin").absolutePath,
                "/system/bin",
                "/system/xbin"
            ).joinToString(":"),
            "PYTHONHOME" to workspace.usr.absolutePath,
            "LD_LIBRARY_PATH" to File(workspace.usr, "lib").absolutePath,
            "SSL_CERT_FILE" to File(workspace.usr, "etc/ca-certificates.pem").absolutePath,
            "TMPDIR" to workspace.tmp.absolutePath,
            "VIRTUAL_ENV" to venv.absolutePath
        ) + extraEnv
    }

    private fun run(
        argv: List<String>,
        cwd: File,
        environment: Map<String, String>,
        timeoutMs: Long,
        onLine: (String) -> Unit = {}
    ): PythonProcessResult {
        val builder = ProcessBuilder(argv).directory(cwd).redirectErrorStream(true)
        val env = builder.environment()
        env.clear()
        env.putAll(ChildEnv.build(environment))
        env["PWD"] = cwd.absolutePath

        val process = try {
            builder.start()
        } catch (e: Exception) {
            throw PythonProjectException("E_IO", "cannot start ${argv.first()}: ${e.message}")
        }
        runCatching { process.outputStream.close() }

        val output = StringBuilder()
        val reader = Thread {
            runCatching {
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        synchronized(output) {
                            if (output.length < 64_384) output.append(line).append('\n')
                        }
                        runCatching { onLine(line) }
                    }
                }
            }
        }.apply { isDaemon = true; start() }

        if (!process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)) {
            process.destroy()
            if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly()
            reader.join(1_000)
            throw PythonProjectException("E_TIMEOUT", "the Python command timed out")
        }
        reader.join(2_000)
        return PythonProcessResult(
            exit = process.exitValue(),
            output = synchronized(output) { output.toString() }
        )
    }

    /** Deletes a tree without following symlinks out of it. */
    private fun deleteTree(file: File) {
        if (Files.isSymbolicLink(file.toPath())) {
            Files.deleteIfExists(file.toPath())
            return
        }
        if (file.isDirectory) file.listFiles().orEmpty().forEach(::deleteTree)
        Files.deleteIfExists(file.toPath())
    }

    companion object {
        const val VENV_DIR = ".venv"
        private const val MARKER = ".leocode-requirements"

        /**
         * Adds `python -> python3` and `pip -> pip3` beside the launcher. Called
         * for a staging prefix during install and for the live prefix on start,
         * so an existing installation gains the aliases without a reinstall.
         */
        fun ensureAliases(bin: File): Boolean {
            if (!File(bin, "python3").isFile) return false
            var ok = true
            for ((name, target) in listOf("python" to "python3", "pip" to "pip3")) {
                val link = File(bin, name)
                if (!File(bin, target).exists()) {
                    ok = false
                    continue
                }
                val current = runCatching { Files.readSymbolicLink(link.toPath()).toString() }
                    .getOrNull()
                if (current == target) continue
                runCatching {
                    if (link.exists() || Files.isSymbolicLink(link.toPath())) {
                        Files.delete(link.toPath())
                    }
                    Files.createSymbolicLink(link.toPath(), File(target).toPath())
                }.onFailure { ok = false }
            }
            return ok && File(bin, "python").exists() && File(bin, "pip").exists()
        }
    }
}

data class PythonProcessResult(val exit: Int, val output: String)
