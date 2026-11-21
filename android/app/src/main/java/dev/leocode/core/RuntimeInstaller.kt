package dev.leocode.core

import android.content.Context
import android.os.Build
import android.os.StatFs
import dev.leocode.BuildConfig
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive

/** A user-facing install failure with a bridge error code. */
class RuntimeInstallException(val code: String, override val message: String) : Exception(message)

/**
 * Installs a runtime package described by a signed `assets/runtime/<id>.json`.
 *
 * Pipeline (Task 25): verify the manifest signature and rollback counter ->
 * check device/space -> resumable download -> SHA-256 -> [SafeExtractor] into
 * `usr.staging` -> launcher + CA + pip -> atomic swap -> health check on the
 * **installed** tree -> keep `usr.old` until the health check passes.
 *
 * Every phase polls [isCancelled]; a cancel during `configure` or `health`
 * destroys the child process instead of waiting out its timeout.
 */
class RuntimeInstaller(
    private val context: Context,
    private val workspace: Workspace,
    private val state: RuntimeStateStore = RuntimeStateStore(
        File(context.filesDir, "runtime-state.properties")
    ),
    private val publicKeys: Map<String, ByteArray> = mapOf("python" to RuntimeKeys.PYTHON),
    private val json: Json = Json { ignoreUnknownKeys = true }
) {

    data class Progress(
        val phase: String,
        val bytes: Long,
        val total: Long,
        val message: String
    )

    /** What `runtime.catalog` reports for one bundled runtime. */
    data class Status(
        val id: String,
        val version: String,
        val versionCode: Int,
        val installed: Boolean,
        val healthy: Boolean,
        val installedVersionCode: Int?
    )

    fun install(
        id: String,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        if (!ID_PATTERN.matches(id)) {
            throw RuntimeInstallException("E_BAD_ENVELOPE", "invalid runtime id: $id")
        }

        val manifest = loadVerifiedManifest(id)
        checkDevice(manifest)
        checkRollback(manifest)
        checkSpace(manifest)
        val previousVersion = state.installedVersion(manifest.id)

        val prefix = workspace.usr
        val downloadDir = File(context.cacheDir, "runtime-download").apply { mkdirs() }
        val artifact = File(downloadDir, "${manifest.id}-${manifest.version}.tar.gz")
        val staging = File(workspace.root, "usr.staging")
        val backup = File(workspace.root, "usr.old")

        var activated = false
        var hadPrevious = false
        try {
            staging.deleteRecursively()
            backup.deleteRecursively()

            emit(onProgress, "preparing", 0, 0, "Preparing ${manifest.id} ${manifest.version}")
            download(manifest, artifact, onProgress, isCancelled)
            verify(manifest, artifact, onProgress, isCancelled)

            staging.mkdirs()
            emit(onProgress, "extract", 0, 0, "Extracting package")
            SafeExtractor().extract(
                artifact,
                staging,
                manifest,
                onProgress = { bytes, files ->
                    emit(
                        onProgress,
                        "extract",
                        bytes,
                        manifest.installedSize,
                        "Extracted ${mb(bytes)} in $files files"
                    )
                },
                isCancelled = isCancelled
            )
            configure(manifest, staging, onProgress, isCancelled)
            verifyExecutables(manifest, staging)
            artifact.delete()

            hadPrevious = activate(staging, backup)
            activated = true
            healthCheck(manifest, prefix, onProgress, isCancelled)
            backup.deleteRecursively()
            state.record(manifest.id, manifest.versionCode)
            emit(onProgress, "done", 0, 0, "${manifest.id} ${manifest.version} installed")
        } catch (e: Throwable) {
            staging.deleteRecursively()
            if (activated) {
                // The health check failed: put the previous tree back rather than
                // leaving a runtime that cannot start.
                prefix.deleteRecursively()
                if (hadPrevious && backup.renameTo(prefix)) {
                    if (previousVersion != null) {
                        state.record(manifest.id, previousVersion)
                    } else {
                        state.clear(manifest.id)
                    }
                } else {
                    state.clear(manifest.id)
                }
            }
            throw e
        }
    }

    /** Remove the installed tree, but only if it belongs to [id]. */
    fun uninstall(id: String) {
        val prefix = workspace.usr
        val marker = readMarker(prefix)
        if (marker?.id != id) {
            throw RuntimeInstallException(
                "E_NOT_FOUND",
                "the ${id} runtime is not installed"
            )
        }
        if (prefix.exists() && !prefix.deleteRecursively()) {
            throw RuntimeInstallException("E_IO", "cannot remove the installed runtime")
        }
        state.clear(id)
        File(context.cacheDir, "runtime-download").deleteRecursively()
    }

    /** Reinstall from scratch; the current tree stays until the new one is healthy. */
    fun repair(
        id: String,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        val marker = readMarker(workspace.usr)
        if (marker?.id == id) {
            // Do not lower the rollback counter for a repair of the same version.
            state.record(id, marker.versionCode)
        }
        install(id, onProgress, isCancelled)
    }

    fun catalog(): List<Status> = listIds().map { id ->
        val manifest = runCatching { loadVerifiedManifest(id) }.getOrNull()
        val marker = readMarker(workspace.usr)
        val installed = manifest != null && marker?.id == id
        val healthy = installed && manifest!!.executables.all { relative ->
            val file = File(workspace.usr, relative)
            file.isFile && file.canExecute()
        }
        Status(
            id = id,
            version = manifest?.version ?: marker?.version ?: "",
            versionCode = manifest?.versionCode ?: marker?.versionCode ?: 0,
            installed = installed,
            healthy = healthy,
            installedVersionCode = state.installedVersion(id)
        )
    }

    // ---------------------------------------------------------------- manifest

    private data class Marker(val id: String, val version: String, val versionCode: Int)

    private fun listIds(): List<String> {
        val assets = runCatching { context.assets.list("runtime") }.getOrNull() ?: emptyArray()
        return assets
            .filter { it.endsWith(".json") }
            .map { it.removeSuffix(".json") }
            .filter { ID_PATTERN.matches(it) }
            .sorted()
    }

    private fun loadVerifiedManifest(id: String): RuntimeManifest {
        val bytes = readAsset("runtime/$id.json")
            ?: throw RuntimeInstallException(
                "E_UNSUPPORTED",
                "no installable package is bundled for $id"
            )
        val signature = readAsset("runtime/$id.json.sig")?.toString(Charsets.UTF_8)
            ?: throw RuntimeInstallException(
                "E_BAD_MANIFEST",
                "the runtime manifest is not signed"
            )
        val key = publicKeys[id]
            ?: throw RuntimeInstallException(
                "E_UNSUPPORTED",
                "no signing key is configured for $id"
            )
        if (!ManifestVerifier(key).verify(bytes, signature)) {
            throw RuntimeInstallException(
                "E_BAD_MANIFEST",
                "the runtime manifest signature is not valid"
            )
        }
        return RuntimeManifest.parse(bytes.toString(Charsets.UTF_8), id)
    }

    private fun readAsset(path: String): ByteArray? = runCatching {
        context.assets.open(path).use { it.readBytes() }
    }.getOrNull()

    private fun checkDevice(manifest: RuntimeManifest) {
        val abi = Build.SUPPORTED_ABIS.firstOrNull() ?: ""
        if (manifest.abi.isNotEmpty() && abi !in manifest.abi) {
            throw RuntimeInstallException(
                "E_UNSUPPORTED",
                "${manifest.id} supports ${manifest.abi.joinToString()}, this device is $abi"
            )
        }
        if (Build.VERSION.SDK_INT < manifest.minAndroid) {
            throw RuntimeInstallException(
                "E_UNSUPPORTED",
                "${manifest.id} needs Android API ${manifest.minAndroid} or newer"
            )
        }
    }

    private fun checkRollback(manifest: RuntimeManifest) {
        val installed = state.installedVersion(manifest.id) ?: return
        if (manifest.versionCode < installed) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "this package is older than the installed ${manifest.id}"
            )
        }
    }

    private fun checkSpace(manifest: RuntimeManifest) {
        // The download, the staging tree and the previous tree coexist until the
        // health check passes (P-06).
        val needed = manifest.size + manifest.installedSize + EXTRACT_HEADROOM
        val free = minOf(
            StatFs(workspace.root.absolutePath).availableBytes,
            StatFs(context.cacheDir.absolutePath).availableBytes
        )
        if (free < needed) {
            throw RuntimeInstallException(
                "E_DISK_FULL",
                "not enough space: ${mb(needed)} needed, ${mb(free)} free. Free up space and retry."
            )
        }
    }

    // ---------------------------------------------------------------- download

    private fun download(
        manifest: RuntimeManifest,
        target: File,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        var offset = if (target.isFile) target.length() else 0L
        if (offset > manifest.size) {
            target.delete()
            offset = 0
        }
        if (offset == manifest.size) {
            emit(onProgress, "download", offset, manifest.size, "Using the downloaded package")
            return
        }

        var lastError: Exception? = null
        for (attempt in 1..DOWNLOAD_ATTEMPTS) {
            if (isCancelled()) throw RuntimeInstallException("E_CANCELLED", "install cancelled")
            try {
                downloadAttempt(manifest, target, onProgress, isCancelled)
                return
            } catch (e: RuntimeInstallException) {
                // A checksum/size violation will not improve on retry.
                if (e.code == "E_CANCELLED" || e.code == "E_INTEGRITY") throw e
                lastError = e
            } catch (e: IOException) {
                lastError = e
            }
            if (attempt < DOWNLOAD_ATTEMPTS) {
                emit(
                    onProgress,
                    "download",
                    target.length(),
                    manifest.size,
                    "Connection lost; resuming (attempt ${attempt + 1} of $DOWNLOAD_ATTEMPTS)"
                )
                runCatching { Thread.sleep(RETRY_DELAY_MS) }
            }
        }
        throw RuntimeInstallException(
            "E_OFFLINE",
            "the download was interrupted: ${lastError?.message ?: "unknown error"}. Retry to resume."
        )
    }

    /**
     * One HTTP request. A partial [target] is resumed with `Range`; the caller
     * retries after a timeout or a dropped connection, which is why the bytes
     * are flushed to the file as they arrive.
     */
    private fun downloadAttempt(
        manifest: RuntimeManifest,
        target: File,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        var offset = if (target.isFile) target.length() else 0L
        if (offset > manifest.size) {
            target.delete()
            offset = 0
        }

        val connection = try {
            (URL(manifest.url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 20_000
                // A slow mobile link can stall for more than 30 s between reads.
                readTimeout = 60_000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "LeoCode/${BuildConfig.VERSION_NAME}")
                // A transparent gzip would break the byte count and the resume.
                setRequestProperty("Accept-Encoding", "identity")
                if (offset > 0) setRequestProperty("Range", "bytes=$offset-")
            }
        } catch (e: IOException) {
            throw RuntimeInstallException(
                "E_OFFLINE",
                "cannot reach the download server: ${e.message}"
            )
        }

        try {
            val code = try {
                connection.responseCode
            } catch (e: IOException) {
                throw RuntimeInstallException("E_OFFLINE", "download failed: ${e.message}")
            }

            when {
                code == HttpURLConnection.HTTP_PARTIAL && offset > 0 -> Unit
                code == HttpURLConnection.HTTP_OK -> {
                    // Server ignored the range request; start over.
                    offset = 0
                    target.delete()
                }
                code == 416 && offset > 0 -> {
                    target.delete()
                    throw RuntimeInstallException(
                        "E_OFFLINE",
                        "download resume failed; retry to start over"
                    )
                }
                code !in 200..299 -> throw RuntimeInstallException(
                    "E_OFFLINE",
                    "download failed: HTTP $code from ${URL(manifest.url).host}"
                )
            }

            val total = if (connection.contentLengthLong > 0) {
                offset + connection.contentLengthLong
            } else {
                manifest.size
            }
            FileOutputStream(target, true).use { output ->
                BufferedInputStream(connection.inputStream).use { input ->
                    val buffer = ByteArray(64 * 1024)
                    var written = offset
                    var lastEmit = 0L
                    while (true) {
                        if (isCancelled()) {
                            throw RuntimeInstallException("E_CANCELLED", "install cancelled")
                        }
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        written += read
                        if (written > manifest.size) {
                            target.delete()
                            throw RuntimeInstallException(
                                "E_INTEGRITY",
                                "the download is larger than the signed size"
                            )
                        }
                        val now = System.currentTimeMillis()
                        if (now - lastEmit > 120) {
                            emit(
                                onProgress,
                                "download",
                                written,
                                total,
                                "Downloading ${mb(written)} of ${mb(total)}"
                            )
                            lastEmit = now
                        }
                    }
                    output.fd.sync()
                    emit(onProgress, "download", written, total, "Downloaded ${mb(written)}")
                }
            }
        } finally {
            connection.disconnect()
        }

        if (target.length() != manifest.size) {
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "download is ${target.length()} bytes, expected ${manifest.size}; retry to resume"
            )
        }
    }

    private fun verify(
        manifest: RuntimeManifest,
        artifact: File,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        emit(onProgress, "verify", 0, artifact.length(), "Verifying SHA-256")
        val digest = MessageDigest.getInstance("SHA-256")
        var read = 0L
        FileInputStream(artifact).use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                if (isCancelled()) {
                    throw RuntimeInstallException("E_CANCELLED", "install cancelled")
                }
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
                read += n
                if (read % (4 * 1024 * 1024) < buffer.size) {
                    emit(onProgress, "verify", read, artifact.length(), "Verifying SHA-256")
                }
            }
        }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        if (!actual.equals(manifest.sha256, ignoreCase = true)) {
            artifact.delete()
            throw RuntimeInstallException(
                "E_INTEGRITY",
                "package checksum mismatch; the download is corrupt. Retry."
            )
        }
    }

    // ---------------------------------------------------------------- configure

    private fun configure(
        manifest: RuntimeManifest,
        staging: File,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        emit(onProgress, "configure", 0, 0, "Installing the Python launcher")

        val bin = File(staging, "bin").apply { mkdirs() }
        val launcher = File(bin, "python3")
        context.assets.open("runtime/python3-launcher").use { input ->
            FileOutputStream(launcher).use { output -> input.copyTo(output) }
        }
        launcher.setExecutable(true, false)

        val etc = File(staging, "etc").apply { mkdirs() }
        val ca = File(etc, "ca-certificates.pem")
        context.assets.open("runtime/cacert.pem").use { input ->
            FileOutputStream(ca).use { output -> input.copyTo(output) }
        }

        if (isCancelled()) throw RuntimeInstallException("E_CANCELLED", "install cancelled")

        // Task 24 will ship pip in the artifact. Until then bootstrap it here and
        // rewrite the shebangs: ensurepip writes the staging path, which stops
        // existing after the atomic swap (P-05).
        val pip = File(bin, "pip3")
        if (!pip.exists()) {
            emit(onProgress, "configure", 0, 0, "Bootstrapping pip")
            val result = runProcess(
                staging,
                listOf(launcher.path, "-m", "ensurepip", "--upgrade"),
                runtimeEnv(staging),
                180_000,
                isCancelled
            )
            if (result.exit != 0) {
                throw RuntimeInstallException(
                    "E_IO",
                    "pip bootstrap failed (exit ${result.exit}): ${result.output.takeLast(400).trim()}"
                )
            }
            rewriteShebangs(staging, staging.absolutePath, workspace.usr.absolutePath)
        }

        File(staging, MARKER).writeText(
            """{"id":"${manifest.id}","version":"${manifest.version}",""" +
                """"versionCode":${manifest.versionCode},"installedAt":${System.currentTimeMillis()}}""" +
                "\n"
        )
    }

    /** Point `#!/<staging>/bin/python3` scripts at the final prefix. */
    private fun rewriteShebangs(root: File, from: String, to: String) {
        val bin = File(root, "bin")
        bin.listFiles().orEmpty().forEach { file ->
            if (!file.isFile || file.length() > 1_000_000) return@forEach
            val firstLine = runCatching {
                file.bufferedReader().use { it.readLine() }
            }.getOrNull() ?: return@forEach
            if (!firstLine.startsWith("#!") || !firstLine.contains(from)) return@forEach
            val text = runCatching { file.readText() }.getOrNull() ?: return@forEach
            runCatching { file.writeText(text.replaceFirst(from, to)) }
        }
    }

    private fun healthCheck(
        manifest: RuntimeManifest,
        prefix: File,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        if (isCancelled()) throw RuntimeInstallException("E_CANCELLED", "install cancelled")
        emit(onProgress, "health", 0, 0, "Running the health check")

        val argv = manifest.healthArgv.map { it.replace("{{prefix}}", prefix.path) }
        val result = runProcess(
            prefix,
            argv,
            runtimeEnv(prefix, manifest),
            manifest.healthTimeoutMs,
            isCancelled
        )
        if (result.exit != 0) {
            throw RuntimeInstallException(
                "E_HEALTH_CHECK",
                "the installed runtime did not start (exit ${result.exit}): " +
                    result.output.takeLast(400).trim()
            )
        }
        emit(onProgress, "health", 0, 0, "Health check passed: ${result.output.trim().take(80)}")
    }

    private fun runtimeEnv(prefix: File, manifest: RuntimeManifest? = null): Map<String, String> {
        val path = prefix.absolutePath
        val fromManifest = manifest?.env.orEmpty().mapValues { (_, value) ->
            value.replace("{{prefix}}", path).replace("{{tmp}}", workspace.tmp.absolutePath)
        }
        return workspace.childEnv() + mapOf(
            "PATH" to listOf("$path/bin", "/system/bin", "/system/xbin").joinToString(":"),
            "PYTHONHOME" to path,
            "LD_LIBRARY_PATH" to "$path/lib",
            "SSL_CERT_FILE" to "$path/etc/ca-certificates.pem",
            "TMPDIR" to workspace.tmp.absolutePath
        ) + fromManifest
    }

    private data class ProcessResult(val exit: Int, val output: String)

    private fun runProcess(
        cwd: File,
        argv: List<String>,
        environment: Map<String, String>,
        timeoutMs: Long,
        isCancelled: () -> Boolean = { false }
    ): ProcessResult {
        val command = resolveCommand(cwd, argv)
        val builder = ProcessBuilder(command).directory(cwd).redirectErrorStream(true)
        val childEnv = builder.environment()
        childEnv.clear()
        childEnv.putAll(environment)

        val process = try {
            builder.start()
        } catch (e: Exception) {
            throw RuntimeInstallException("E_IO", "cannot run ${argv.first()}: ${e.message}")
        }

        val output = StringBuilder()
        val reader = Thread {
            runCatching {
                process.inputStream.bufferedReader().useLines { lines ->
                    lines.forEach { line ->
                        synchronized(output) {
                            if (output.length < 16_384) output.append(line).append('\n')
                        }
                    }
                }
            }
        }.apply { isDaemon = true; start() }

        val deadline = System.currentTimeMillis() + timeoutMs
        while (true) {
            if (process.waitFor(100, TimeUnit.MILLISECONDS)) break
            if (isCancelled()) {
                process.destroy()
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly()
                throw RuntimeInstallException("E_CANCELLED", "install cancelled")
            }
            if (System.currentTimeMillis() > deadline) {
                process.destroy()
                if (!process.waitFor(2, TimeUnit.SECONDS)) process.destroyForcibly()
                reader.join(1_000)
                throw RuntimeInstallException(
                    "E_TIMEOUT",
                    "${argv.first()} did not finish within ${timeoutMs / 1000}s"
                )
            }
        }
        reader.join(2_000)
        val text = synchronized(output) { output.toString() }
        return ProcessResult(process.exitValue(), text)
    }

    // ----------------------------------------------------------------- activate

    /** Move staging into place; returns true when a previous tree was kept. */
    private fun activate(staging: File, backup: File): Boolean {
        val prefix = workspace.usr
        var hadPrevious = false
        if (prefix.exists()) {
            backup.deleteRecursively()
            if (!prefix.renameTo(backup)) {
                throw RuntimeInstallException(
                    "E_IO",
                    "cannot replace the existing runtime in ${prefix.path}"
                )
            }
            hadPrevious = true
        }
        if (!staging.renameTo(prefix)) {
            if (hadPrevious) backup.renameTo(prefix)
            throw RuntimeInstallException("E_IO", "cannot move the runtime into ${prefix.path}")
        }
        return hadPrevious
    }

    private fun readMarker(prefix: File): Marker? {
        val file = File(prefix, MARKER)
        if (!file.isFile) return null
        val obj = runCatching {
            json.parseToJsonElement(file.readText()) as? JsonObject
        }.getOrNull() ?: return null
        val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return null
        val version = obj["version"]?.jsonPrimitive?.contentOrNull ?: ""
        val code = obj["versionCode"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0
        return Marker(id, version, code)
    }

    private fun emit(
        onProgress: (Progress) -> Unit,
        phase: String,
        bytes: Long,
        total: Long,
        message: String
    ) {
        onProgress(Progress(phase, bytes, total, message))
    }

    private fun mb(bytes: Long): String =
        if (bytes >= 1024L * 1024L) "%.1f MB".format(bytes / 1024.0 / 1024.0)
        else "${bytes / 1024} KB"

    companion object {
        private val ID_PATTERN = Regex("^[a-z][a-z0-9-]{1,32}$")
        private const val MARKER = ".leocode-runtime.json"
        private const val EXTRACT_HEADROOM = 32L * 1024 * 1024
        private const val DOWNLOAD_ATTEMPTS = 3
        private const val RETRY_DELAY_MS = 2_000L

        /**
         * The package may legitimately ship no executable (the official
         * python.org Android build has only `libpython`); `configure()` adds the
         * launcher. Check the promise after that, not while extracting.
         */
        fun verifyExecutables(manifest: RuntimeManifest, prefix: File) {
            val root = prefix.canonicalFile.toPath()
            for (executable in manifest.executables) {
                val file = File(prefix, normalizeRelative(executable)).canonicalFile
                if (!file.toPath().startsWith(root)) {
                    throw RuntimeInstallException(
                        "E_BAD_MANIFEST",
                        "invalid executable path in manifest: $executable"
                    )
                }
                if (!file.isFile) {
                    throw RuntimeInstallException(
                        "E_INTEGRITY",
                        "package is missing $executable"
                    )
                }
                if (!file.canExecute()) file.setExecutable(true, false)
            }
        }

        fun normalizeRelative(path: String): String {
            val parts = path.replace('\\', '/').split('/')
                .filter { it.isNotEmpty() && it != "." }
            if (parts.isEmpty() || parts.any { it == ".." }) {
                throw RuntimeInstallException("E_BAD_MANIFEST", "invalid path in manifest: $path")
            }
            return parts.joinToString("/")
        }

        /**
         * `ProcessBuilder` resolves a relative executable against the app's own
         * working directory, not the child's `directory`. Resolve anything with
         * a path separator against [cwd] so `bin/python3` works; a bare name is
         * left for the OS to find on PATH.
         */
        fun resolveCommand(cwd: File, argv: List<String>): List<String> {
            if (argv.isEmpty()) return argv
            val command = argv.first()
            if (!command.contains('/') || File(command).isAbsolute) return argv
            return listOf(File(cwd, command).path) + argv.drop(1)
        }
    }
}
