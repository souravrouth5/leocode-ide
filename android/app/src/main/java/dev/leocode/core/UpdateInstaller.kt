package dev.leocode.core

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.StatFs
import android.provider.Settings
import androidx.core.content.FileProvider
import dev.leocode.BuildConfig
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Download, verify and hand an APK to Android's installer (Task 28).
 *
 * Three gates before the installer is even opened:
 * 1. the bytes match the SHA-256 and size in the signed manifest;
 * 2. the APK's package and version code match the manifest;
 * 3. the APK is signed with the same certificate set as the installed app.
 *
 * Gate 3 is the real trust anchor: even if the manifest host is compromised,
 * an attacker cannot produce an APK that Android will accept as an update to
 * this installation. The install itself is always a visible system prompt;
 * LeoCode never installs silently.
 */
class UpdateInstaller(private val context: Context) {

    data class Progress(val phase: String, val bytes: Long, val total: Long)

    fun downloadAndInstall(
        url: String,
        sha256: String,
        size: Long,
        versionCode: Int,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ): File {
        if (url.isBlank() || !sha256.matches(Regex("^[a-f0-9]{64}$")) || size <= 0) {
            throw UpdateException("E_BAD_MANIFEST", "the update details are incomplete")
        }

        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        // A stale APK from an older attempt only wastes space.
        dir.listFiles()?.forEach { it.delete() }
        val target = File(dir, "leocode-$versionCode.apk")

        val free = StatFs(context.cacheDir.absolutePath).availableBytes
        if (free < size + DISK_HEADROOM) {
            throw UpdateException(
                "E_DISK_FULL",
                "there is not enough free space for this update"
            )
        }

        try {
            download(url, target, size, onProgress, isCancelled)
            onProgress(Progress("verify", size, size))
            val actual = FileHash.sha256(target)
            if (actual != sha256.lowercase()) {
                target.delete()
                throw UpdateException("E_INTEGRITY", "the update failed its integrity check")
            }
            verifyApk(target, versionCode)
            onProgress(Progress("install", size, size))
            openInstaller(target)
            return target
        } catch (e: UpdateException) {
            if (e.code != "E_PERMISSION") target.delete()
            throw e
        } catch (e: Throwable) {
            target.delete()
            throw UpdateException("E_IO", "the update could not be prepared")
        }
    }

    private fun download(
        url: String,
        target: File,
        size: Long,
        onProgress: (Progress) -> Unit,
        isCancelled: () -> Boolean
    ) {
        val connection = try {
            URL(url).openConnection()
        } catch (e: IOException) {
            throw UpdateException("E_OFFLINE", "cannot reach the update server")
        }

        try {
            if (connection is HttpURLConnection) {
                connection.connectTimeout = 20_000
                connection.readTimeout = 60_000
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("User-Agent", "LeoCode/${BuildConfig.VERSION_NAME}")
                connection.setRequestProperty("Accept-Encoding", "identity")
                val code = runCatching { connection.responseCode }.getOrElse {
                    throw UpdateException("E_OFFLINE", "the update server did not answer")
                }
                if (code !in 200..299) {
                    throw UpdateException("E_OFFLINE", "the update server answered HTTP $code")
                }
            }

            val digest = MessageDigest.getInstance("SHA-256")
            var written = 0L
            var lastReport = 0L
            connection.getInputStream().use { input ->
                FileOutputStream(target).use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        if (isCancelled()) throw UpdateException("E_CANCELLED", "update cancelled")
                        val read = input.read(buffer)
                        if (read < 0) break
                        written += read
                        if (written > size + DISK_HEADROOM) {
                            throw UpdateException("E_INTEGRITY", "the update is larger than expected")
                        }
                        digest.update(buffer, 0, read)
                        output.write(buffer, 0, read)
                        val now = System.currentTimeMillis()
                        if (now - lastReport >= 250) {
                            lastReport = now
                            onProgress(Progress("download", written, size))
                        }
                    }
                    output.flush()
                }
            }
            if (written != size) {
                throw UpdateException("E_INTEGRITY", "the update is not the expected size")
            }
            onProgress(Progress("download", written, size))
        } catch (e: UpdateException) {
            throw e
        } catch (e: IOException) {
            throw UpdateException("E_OFFLINE", "the update download was interrupted")
        } finally {
            (connection as? HttpURLConnection)?.disconnect()
        }
    }

    private fun verifyApk(apk: File, versionCode: Int) {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(apk.absolutePath, PackageManagerFlags.SIGNING)
            ?: throw UpdateException(
                "E_INTEGRITY",
                "the update is not a valid APK for this device"
            )

        if (archive.packageName != context.packageName) {
            throw UpdateException("E_INTEGRITY", "the update is for a different app")
        }
        if (archive.longVersionCode != versionCode.toLong()) {
            throw UpdateException("E_INTEGRITY", "the update version does not match the manifest")
        }

        val installed = pm.getPackageInfo(context.packageName, PackageManagerFlags.SIGNING)
        val installedSigners = signerDigests(installed)
        val archiveSigners = signerDigests(archive)
        if (archiveSigners.isEmpty()) {
            // API 28/29/33 only collect archive certificates for GET_SIGNATURES;
            // an empty set here means the APK's signer could not be read at all.
            throw UpdateException("E_INTEGRITY", "the update's signature could not be read")
        }
        if (installedSigners.isEmpty() || archiveSigners != installedSigners) {
            android.util.Log.w(
                "LeoCodeUpdate",
                "signer mismatch: installed=$installedSigners archive=$archiveSigners"
            )
            throw UpdateException(
                "E_INTEGRITY",
                "the update is not signed with this app's certificate"
            )
        }
    }

    /**
     * Certificate digests for an installed package or an APK archive.
     *
     * `signingInfo` is the modern source, but API 28/29/33 only collect
     * certificates for an archive when GET_SIGNATURES is set, so fall back to
     * the legacy `signatures` field. Both are the DER certificate bytes.
     */
    @Suppress("DEPRECATION")
    private fun signerDigests(info: android.content.pm.PackageInfo): Set<String> {
        val signers = info.signingInfo?.apkContentsSigners?.takeIf { it.isNotEmpty() }
            ?: info.signatures.orEmpty()
        return signers.map { FileHash.sha256(it.toByteArray()) }.toSet()
    }

    private fun openInstaller(apk: File) {
        val pm = context.packageManager
        if (!pm.canRequestPackageInstalls()) {
            // Send the user to the per-app switch; the next check can retry.
            runCatching {
                context.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${context.packageName}")
                    ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                )
            }
            throw UpdateException(
                "E_PERMISSION",
                "allow LeoCode to install unknown apps, then check for updates again"
            )
        }

        val uri = FileProvider.getUriForFile(
            context,
            "${context.packageName}.updates",
            apk
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
        } catch (e: Throwable) {
            throw UpdateException("E_IO", "Android did not open its package installer")
        }
    }

    /** Both signing flags, without the API-33 flags object. */
    internal object PackageManagerFlags {
        @Suppress("DEPRECATION")
        const val SIGNING = android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES or
            android.content.pm.PackageManager.GET_SIGNATURES
    }

    companion object {
        private const val DISK_HEADROOM = 8L * 1024L * 1024L
    }
}
