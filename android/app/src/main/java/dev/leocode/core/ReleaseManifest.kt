package dev.leocode.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * A published app release, `release.json` (Task 28).
 *
 * The file is signed with the offline Ed25519 key ([ReleaseKeys]) and the
 * detached signature is served next to it as `release.json.sig`. The manifest
 * names the APK, its SHA-256 and its version code; [UpdateChecker] rejects a
 * manifest whose package, minimum SDK or signature does not match, and
 * [UpdateInstaller] refuses an APK that is not signed with the same certificate
 * as the installed app.
 */
data class ReleaseManifest(
    val schema: Int,
    val packageName: String,
    val versionName: String,
    val versionCode: Int,
    val minSdk: Int,
    val apkUrl: String,
    val apkSha256: String,
    val apkSize: Long,
    val notes: String
) {
    companion object {
        const val SCHEMA = 1
        const val MAX_NOTES = 4_000
        private val SHA256 = Regex("^[a-f0-9]{64}$")
        private val json = Json { ignoreUnknownKeys = true }

        fun parse(text: String): ReleaseManifest {
            val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull()
                ?: throw UpdateException("E_BAD_MANIFEST", "the release manifest is not valid JSON")

            fun str(key: String): String =
                root[key]?.jsonPrimitive?.contentOrNull
                    ?: throw UpdateException("E_BAD_MANIFEST", "the release manifest is missing $key")

            fun int(key: String): Int =
                root[key]?.jsonPrimitive?.intOrNull
                    ?: throw UpdateException("E_BAD_MANIFEST", "the release manifest is missing $key")

            val apk = root["apk"] as? JsonObject
                ?: throw UpdateException("E_BAD_MANIFEST", "the release manifest is missing apk")

            fun apkStr(key: String): String =
                apk[key]?.jsonPrimitive?.contentOrNull
                    ?: throw UpdateException("E_BAD_MANIFEST", "the release manifest is missing apk.$key")

            val schema = int("schema")
            if (schema != SCHEMA) {
                throw UpdateException("E_BAD_MANIFEST", "unsupported release manifest schema $schema")
            }
            val versionName = str("versionName").trim()
            val versionCode = int("versionCode")
            val minSdk = int("minSdk")
            val apkUrl = apkStr("url").trim()
            val apkSha256 = apkStr("sha256").trim().lowercase()
            val apkSize = apk["size"]?.jsonPrimitive?.longOrNull
                ?: throw UpdateException("E_BAD_MANIFEST", "the release manifest is missing apk.size")
            val notes = root["notes"]?.jsonPrimitive?.contentOrNull.orEmpty().take(MAX_NOTES)

            if (versionName.isEmpty()) {
                throw UpdateException("E_BAD_MANIFEST", "the release manifest has no version name")
            }
            if (versionCode <= 0) {
                throw UpdateException("E_BAD_MANIFEST", "the release manifest has an invalid version code")
            }
            if (minSdk <= 0) {
                throw UpdateException("E_BAD_MANIFEST", "the release manifest has an invalid minSdk")
            }
            if (!apkUrl.startsWith("https://") && !apkUrl.startsWith("http://") &&
                !apkUrl.startsWith("file://")
            ) {
                throw UpdateException("E_BAD_MANIFEST", "the release APK URL is not a supported URL")
            }
            if (!SHA256.matches(apkSha256)) {
                throw UpdateException("E_BAD_MANIFEST", "the release APK hash is not SHA-256")
            }
            if (apkSize <= 0) {
                throw UpdateException("E_BAD_MANIFEST", "the release APK size is invalid")
            }

            return ReleaseManifest(
                schema = schema,
                packageName = str("package"),
                versionName = versionName,
                versionCode = versionCode,
                minSdk = minSdk,
                apkUrl = apkUrl,
                apkSha256 = apkSha256,
                apkSize = apkSize,
                notes = notes
            )
        }
    }
}

/** A failed update step; [code] is a bridge error code, [message] is safe to show. */
class UpdateException(val code: String, override val message: String) : Exception(message)
