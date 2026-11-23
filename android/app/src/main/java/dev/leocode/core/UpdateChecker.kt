package dev.leocode.core

import android.content.Context
import android.os.Build
import dev.leocode.BuildConfig
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Fetch and verify `release.json` (Task 28).
 *
 * The manifest is small and signed; the APK is not downloaded here. A failed
 * check never changes the installed app. The URL comes from
 * `BuildConfig.UPDATE_MANIFEST_URL`, so a demo or a mirror can be selected at
 * build time without a runtime setting an attacker could flip.
 */
class UpdateChecker(
    private val context: Context,
    private val manifestUrl: String = BuildConfig.UPDATE_MANIFEST_URL
) {

    data class UpdateInfo(
        val available: Boolean,
        val currentVersion: String,
        val manifest: ReleaseManifest?
    )

    fun check(): UpdateInfo {
        val payload = fetch(manifestUrl, MAX_MANIFEST_BYTES)
        val signature = fetch("$manifestUrl.sig", MAX_SIGNATURE_BYTES)
            .toString(Charsets.UTF_8)

        if (!ManifestVerifier(ReleaseKeys.RELEASE).verify(payload, signature)) {
            throw UpdateException(
                "E_BAD_MANIFEST",
                "the update manifest signature is missing or does not match this app"
            )
        }

        val manifest = ReleaseManifest.parse(payload.toString(Charsets.UTF_8))
        if (manifest.packageName != context.packageName) {
            throw UpdateException("E_BAD_MANIFEST", "the update is for a different app")
        }
        if (manifest.minSdk > Build.VERSION.SDK_INT) {
            throw UpdateException(
                "E_UNSUPPORTED",
                "this update needs Android ${manifest.minSdk} or newer"
            )
        }

        return UpdateInfo(
            available = manifest.versionCode > BuildConfig.VERSION_CODE,
            currentVersion = BuildConfig.VERSION_NAME,
            manifest = manifest
        )
    }

    /** Reads a small resource with a hard cap, following redirects for HTTP. */
    private fun fetch(url: String, limit: Int): ByteArray {
        val connection = try {
            URL(url).openConnection()
        } catch (e: IOException) {
            throw UpdateException("E_OFFLINE", "cannot reach the update server")
        }

        try {
            if (connection is HttpURLConnection) {
                connection.connectTimeout = 15_000
                connection.readTimeout = 20_000
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
            connection.getInputStream().use { return readLimited(it, limit) }
        } catch (e: UpdateException) {
            throw e
        } catch (e: IOException) {
            throw UpdateException("E_OFFLINE", "the update download failed")
        } finally {
            (connection as? HttpURLConnection)?.disconnect()
        }
    }

    private fun readLimited(input: InputStream, limit: Int): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        var total = 0
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            total += read
            if (total > limit) {
                throw UpdateException("E_BAD_MANIFEST", "the update manifest is too large")
            }
            out.write(buffer, 0, read)
        }
        return out.toByteArray()
    }

    companion object {
        private const val MAX_MANIFEST_BYTES = 64 * 1024
        private const val MAX_SIGNATURE_BYTES = 1024
    }
}
