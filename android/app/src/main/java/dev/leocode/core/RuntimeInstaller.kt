package dev.leocode.core

import android.content.Context
import android.os.Build
import android.os.StatFs
import dev.leocode.BuildConfig
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.nio.file.Files
import java.nio.file.Paths
import java.security.MessageDigest
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** A user-facing install failure with a bridge error code. */
class RuntimeInstallException(val code: String, override val message: String) : Exception(message)

/**
 * Installs a runtime package described by `assets/runtime/<id>.json`.
 *
 * Pipeline: resumable download -> SHA-256 -> safe tar.gz extraction -> bundled
 * launcher + CA bundle -> ensurepip -> health check -> atomic swap into
 * `files/usr`. Progress is reported as (phase, bytes, total, message); cancel
 * is polled between chunks so a long download stops promptly.
 *
 * Artifacts are pinned by URL + SHA-256 in the app-shipped manifest. Manifest
 * signatures (Task 24) are not implemented yet, so this trusts the APK: never
 * install a manifest that did not ship inside a signed build.
 */
class RuntimeInstaller(
    private val context: Context,
    private val workspace: Workspace,
    private val json: Json = Json { ignoreUnknownKeys = true }
) {

    data class Progress(
        val phase: String,
        val bytes: Long,
        val total: Long,
        val message: String
    )

    fun install(
        id: String,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        if (!ID_PATTERN.matches(id)) {
            throw RuntimeInstallException("E_BAD_ENVELOPE", "invalid runtime id: $id")
        }

        val manifest = loadManifest(id)
        checkDevice(manifest)
        val prefix = workspace.usr
        checkSpace(manifest)

        val downloadDir = File(context.cacheDir, "runtime-download").apply { mkdirs() }
        val artifact = File(downloadDir, "${manifest.id}-${manifest.version}.tar.gz")
        val staging = File(workspace.root, "usr.staging")
        val backup = File(workspace.root, "usr.old")

        try {
            staging.deleteRecursively()
            backup.deleteRecursively()

            emit(onProgress, "preparing", 0, 0, "Preparing ${manifest.id} ${manifest.version}")
            download(manifest, artifact, onProgress, isCancelled)
            verify(manifest, artifact, onProgress, isCancelled)

            staging.mkdirs()
            extract(manifest, artifact, staging, onProgress, isCancelled)
            configure(manifest, staging, onProgress, isCancelled)
            healthCheck(manifest, staging, onProgress, isCancelled)
            activate(staging, backup)
            artifact.delete()

            onProgress(Progress("done", 0, 0, "${manifest.id} ${manifest.version} installed"))
        } catch (e: Throwable) {
            staging.deleteRecursively()
            throw e
        }
    }

    // ---------------------------------------------------------------- manifest

    private data class Manifest(
        val id: String,
        val version: String,
        val versionCode: Int,
        val abi: List<String>,
        val minAndroid: Int,
        val url: String,
        val sha256: String,
        val size: Long,
        val layout: String,
        val strip: Int,
        val env: Map<String, String>,
        val healthArgv: List<String>,
        val healthTimeoutMs: Long
    )

    private fun loadManifest(id: String): Manifest {
        val text = try {
            context.assets.open("runtime/$id.json").bufferedReader().use { it.readText() }
        } catch (_: Exception) {
            throw RuntimeInstallException("E_UNSUPPORTED", "no installable package is bundled for $id")
        }
        val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull()
            ?: throw RuntimeInstallException("E_BAD_MANIFEST", "runtime manifest is not valid JSON")

        fun str(key: String): String =
            root[key]?.jsonPrimitive?.contentOrNull
                ?: throw RuntimeInstallException("E_BAD_MANIFEST", "manifest is missing $key")

        val artifact = root["artifact"] as? JsonObject
            ?: throw RuntimeInstallException("E_BAD_MANIFEST", "manifest is missing artifact")
        val install = root["install"] as? JsonObject
            ?: throw RuntimeInstallException("E_BAD_MANIFEST", "manifest is missing install")
        val envObj = root["env"] as? JsonObject ?: JsonObject(emptyMap())
        val health = root["healthCheck"] as? JsonObject

        val abi = (root["abi"] as? JsonArray)?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
        val healthArgv = (health?.get("argv") as? JsonArray)
            ?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()

        return Manifest(
            id = str("id"),
            version = str("version"),
            versionCode = root["versionCode"]?.jsonPrimitive?.intOrNull ?: 1,
            abi = abi,
            minAndroid = root["minAndroid"]?.jsonPrimitive?.intOrNull ?: 28,
            url = artifact["url"]?.jsonPrimitive?.contentOrNull ?: "",
            sha256 = artifact["sha256"]?.jsonPrimitive?.contentOrNull ?: "",
            size = artifact["size"]?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: 0,
            layout = install["layout"]?.jsonPrimitive?.contentOrNull ?: "prefix",
            strip = install["strip"]?.jsonPrimitive?.intOrNull ?: 0,
            env = envObj.mapValues { it.value.jsonPrimitive.contentOrNull ?: "" },
            healthArgv = healthArgv,
            healthTimeoutMs = health?.get("timeoutMs")?.jsonPrimitive?.contentOrNull?.toLongOrNull() ?: 30_000
        ).also {
            if (it.id != id) {
                throw RuntimeInstallException("E_BAD_MANIFEST", "manifest id mismatch: $id vs ${it.id}")
            }
            if (!it.url.startsWith("https://")) {
                throw RuntimeInstallException("E_BAD_MANIFEST", "artifact URL must be https")
            }
            if (!SHA256_PATTERN.matches(it.sha256)) {
                throw RuntimeInstallException("E_BAD_MANIFEST", "artifact sha256 is missing or malformed")
            }
            if (it.size <= 0) {
                throw RuntimeInstallException("E_BAD_MANIFEST", "artifact size is missing")
            }
        }
    }

    private fun checkDevice(manifest: Manifest) {
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

    private fun checkSpace(manifest: Manifest) {
        val needed = manifest.size + EXTRACT_HEADROOM
        val free = StatFs(workspace.root.absolutePath).availableBytes
        if (free < needed) {
            throw RuntimeInstallException(
                "E_DISK_FULL",
                "not enough space: ${mb(needed)} needed, ${mb(free)} free. Free up space and retry."
            )
        }
    }

    // ---------------------------------------------------------------- download

    private fun download(
        manifest: Manifest,
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

        val connection = try {
            (URL(manifest.url).openConnection() as HttpURLConnection).apply {
                connectTimeout = 20_000
                readTimeout = 30_000
                instanceFollowRedirects = true
                setRequestProperty("User-Agent", "LeoCode/${BuildConfig.VERSION_NAME}")
                if (offset > 0) setRequestProperty("Range", "bytes=$offset-")
            }
        } catch (e: Exception) {
            throw RuntimeInstallException("E_OFFLINE", "cannot reach python.org: ${e.message}")
        }

        try {
            val code = try {
                connection.responseCode
            } catch (e: Exception) {
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
                    throw RuntimeInstallException("E_OFFLINE", "download resume failed; retry to start over")
                }
                code !in 200..299 -> throw RuntimeInstallException(
                    "E_OFFLINE",
                    "download failed: HTTP $code from ${URL(manifest.url).host}"
                )
            }

            val total = if (connection.contentLengthLong > 0) offset + connection.contentLengthLong else manifest.size
            FileOutputStream(target, true).use { output ->
                val input = BufferedInputStream(connection.inputStream)
                val buffer = ByteArray(64 * 1024)
                var written = offset
                var lastEmit = 0L
                while (true) {
                    if (isCancelled()) throw RuntimeInstallException("E_CANCELLED", "install cancelled")
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    written += read
                    val now = System.currentTimeMillis()
                    if (now - lastEmit > 120) {
                        emit(onProgress, "download", written, total, "Downloading ${mb(written)} of ${mb(total)}")
                        lastEmit = now
                    }
                }
                output.fd.sync()
                emit(onProgress, "download", written, total, "Downloaded ${mb(written)}")
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
        manifest: Manifest,
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
                if (isCancelled()) throw RuntimeInstallException("E_CANCELLED", "install cancelled")
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

    // --------------------------------------------------------------- extraction

    private fun extract(
        manifest: Manifest,
        artifact: File,
        staging: File,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        emit(onProgress, "extract", 0, 0, "Extracting package")
        val root = staging.canonicalFile
        var written = 0L
        var lastEmit = 0L

        FileInputStream(artifact).use { fileIn ->
            BufferedInputStream(fileIn).use { buffered ->
                GzipCompressorInputStream(buffered).use { gzip ->
                    TarArchiveInputStream(gzip).use { tar ->
                        var entry: TarArchiveEntry? = tar.nextEntry
                        while (entry != null) {
                            if (isCancelled()) throw RuntimeInstallException("E_CANCELLED", "install cancelled")
                            val name = entry.name
                            val relative = relativeEntryPath(name, manifest.strip)
                            if (relative == null) {
                                entry = tar.nextEntry
                                continue
                            }
                            if (isPruned(relative)) {
                                entry = tar.nextEntry
                                continue
                            }

                            val destination = safeDestination(root, relative)
                            when {
                                entry.isDirectory -> {
                                    if (!destination.mkdirs() && !destination.isDirectory) {
                                        throw RuntimeInstallException("E_IO", "cannot create ${destination.path}")
                                    }
                                }
                                entry.isSymbolicLink -> {
                                    createSymlink(root, destination, entry.linkName)
                                }
                                entry.isFile -> {
                                    destination.parentFile?.mkdirs()
                                    FileOutputStream(destination).use { output ->
                                        tar.copyTo(output)
                                    }
                                    written += entry.size
                                    if (entry.mode and 0x49 != 0) {
                                        destination.setExecutable(true, false)
                                    }
                                    val now = System.currentTimeMillis()
                                    if (now - lastEmit > 250) {
                                        emit(onProgress, "extract", written, 0, "Extracting ${mb(written)}")
                                        lastEmit = now
                                    }
                                }
                                else -> {
                                    // Devices and FIFOs have no place in a runtime prefix.
                                    throw RuntimeInstallException(
                                        "E_INTEGRITY",
                                        "package contains an unsupported entry: $name"
                                    )
                                }
                            }
                            entry = tar.nextEntry
                        }
                    }
                }
            }
        }
        emit(onProgress, "extract", written, written, "Extracted ${mb(written)}")
    }

    /** Strip the archive's leading components and reject anything suspicious. */
    private fun relativeEntryPath(rawName: String, strip: Int): String? {
        val name = rawName.replace('\\', '/')
        if (name.startsWith("/")) {
            throw RuntimeInstallException("E_INTEGRITY", "package contains an absolute path: $rawName")
        }
        val parts = name.split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.any { it == ".." }) {
            throw RuntimeInstallException("E_INTEGRITY", "package path escapes the prefix: $rawName")
        }
        if (parts.size <= strip) return null
        // The python.org package nests everything under prefix/; other top-level
        // files (README, testbed) are build leftovers and must not be installed.
        if (parts.first() != "prefix") return null
        return parts.drop(strip).joinToString("/")
    }

    private fun isPruned(relative: String): Boolean {
        if (relative == "include" || relative.startsWith("include/")) return true
        if (relative == "lib/pkgconfig" || relative.startsWith("lib/pkgconfig/")) return true
        // CPython's own test suite is ~38 MB and never needed at runtime.
        if (relative.matches(Regex("lib/python\\d+\\.\\d+/test(/.*)?"))) return true
        return false
    }

    private fun safeDestination(root: File, relative: String): File {
        val destination = File(root, relative).canonicalFile
        val rootPath = root.path + File.separator
        if (destination != root && !destination.path.startsWith(rootPath)) {
            throw RuntimeInstallException("E_INTEGRITY", "package path escapes the prefix: $relative")
        }
        return destination
    }

    private fun createSymlink(root: File, link: File, rawTarget: String) {
        if (rawTarget.startsWith("/")) {
            throw RuntimeInstallException("E_INTEGRITY", "package contains an absolute symlink: ${link.name}")
        }
        val resolved = File(link.parentFile, rawTarget).canonicalFile
        val rootPath = root.path + File.separator
        if (!resolved.path.startsWith(rootPath)) {
            throw RuntimeInstallException("E_INTEGRITY", "symlink escapes the prefix: ${link.name}")
        }
        link.parentFile?.mkdirs()
        link.delete()
        try {
            Files.createSymbolicLink(Paths.get(link.path), Paths.get(rawTarget))
        } catch (e: Exception) {
            throw RuntimeInstallException("E_IO", "cannot create symlink ${link.name}: ${e.message}")
        }
    }

    // ---------------------------------------------------------------- configure

    private fun configure(
        manifest: Manifest,
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
        emit(onProgress, "configure", 0, 0, "Bootstrapping pip")
        val pip = runProcess(
            staging,
            listOf(launcher.path, "-m", "ensurepip", "--upgrade"),
            runtimeEnv(staging),
            180_000
        )
        if (pip.exit != 0) {
            throw RuntimeInstallException(
                "E_IO",
                "pip bootstrap failed (exit ${pip.exit}): ${pip.output.takeLast(400).trim()}"
            )
        }

        File(staging, ".leocode-runtime.json").writeText(
            """
            {"id":"${manifest.id}","version":"${manifest.version}","versionCode":${manifest.versionCode}}
            """.trimIndent() + "\n"
        )
    }

    private fun healthCheck(
        manifest: Manifest,
        staging: File,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        if (manifest.healthArgv.isEmpty()) return
        if (isCancelled()) throw RuntimeInstallException("E_CANCELLED", "install cancelled")
        emit(onProgress, "health", 0, 0, "Running the health check")

        val argv = manifest.healthArgv.map { it.replace("{{prefix}}", staging.path) }
        val result = runProcess(staging, argv, runtimeEnv(staging), manifest.healthTimeoutMs)
        if (result.exit != 0) {
            throw RuntimeInstallException(
                "E_HEALTH_CHECK",
                "the installed runtime did not start (exit ${result.exit}): ${result.output.takeLast(400).trim()}"
            )
        }
        emit(onProgress, "health", 0, 0, "Health check passed: ${result.output.trim().take(80)}")
    }

    private fun runtimeEnv(staging: File): Map<String, String> {
        val path = staging.absolutePath
        return workspace.childEnv() + mapOf(
            "PATH" to listOf("$path/bin", "/system/bin", "/system/xbin").joinToString(":"),
            "PYTHONHOME" to path,
            "LD_LIBRARY_PATH" to "$path/lib",
            "SSL_CERT_FILE" to "$path/etc/ca-certificates.pem",
            "TMPDIR" to workspace.tmp.absolutePath
        )
    }

    private data class ProcessResult(val exit: Int, val output: String)

    private fun runProcess(
        cwd: File,
        argv: List<String>,
        environment: Map<String, String>,
        timeoutMs: Long
    ): ProcessResult {
        val builder = ProcessBuilder(argv).directory(cwd).redirectErrorStream(true)
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

        val finished = process.waitFor(timeoutMs, TimeUnit.MILLISECONDS)
        if (!finished) {
            process.destroyForcibly()
            reader.join(1_000)
            throw RuntimeInstallException("E_TIMEOUT", "${argv.first()} did not finish within ${timeoutMs / 1000}s")
        }
        reader.join(2_000)
        val text = synchronized(output) { output.toString() }
        return ProcessResult(process.exitValue(), text)
    }

    // ----------------------------------------------------------------- activate

    private fun activate(staging: File, backup: File) {
        val prefix = workspace.usr
        if (prefix.exists()) {
            if (!prefix.renameTo(backup)) {
                throw RuntimeInstallException("E_IO", "cannot replace the existing runtime in ${prefix.path}")
            }
        }
        if (!staging.renameTo(prefix)) {
            backup.renameTo(prefix)
            throw RuntimeInstallException("E_IO", "cannot move the runtime into ${prefix.path}")
        }
        backup.deleteRecursively()
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
        private val SHA256_PATTERN = Regex("^[a-f0-9]{64}$")
        private const val EXTRACT_HEADROOM = 80L * 1024 * 1024
    }
}
