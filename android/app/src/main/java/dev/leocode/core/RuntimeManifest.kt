package dev.leocode.core

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * The runtime package manifest, `assets/runtime/<id>.json` (Task 25).
 *
 * The manifest is covered by a detached Ed25519 signature over its exact bytes
 * (`<id>.json.sig`). The public key is compiled into the APK ([RuntimeKeys]), so
 * replacing both files inside a modified APK does not help an attacker: they
 * would also have to re-sign the APK. See [ManifestVerifier].
 */
data class RuntimeManifest(
    val schema: Int,
    val id: String,
    val version: String,
    val versionCode: Int,
    val abi: List<String>,
    val minAndroid: Int,
    val url: String,
    val sha256: String,
    val size: Long,
    val installedSize: Long,
    val layout: String,
    val strip: Int,
    val prefix: String,
    val executables: List<String>,
    val env: Map<String, String>,
    val healthArgv: List<String>,
    val healthTimeoutMs: Long
) {
    companion object {
        const val SCHEMA = 1
        private val ID = Regex("^[a-z][a-z0-9-]{1,32}$")
        private val SHA256 = Regex("^[a-f0-9]{64}$")

        private val json = Json { ignoreUnknownKeys = true }

        fun parse(text: String, expectedId: String? = null): RuntimeManifest {
            val root = runCatching { json.parseToJsonElement(text) as? JsonObject }.getOrNull()
                ?: throw RuntimeInstallException(
                    "E_BAD_MANIFEST",
                    "runtime manifest is not valid JSON"
                )

            fun str(key: String): String =
                root[key]?.jsonPrimitive?.contentOrNull
                    ?: throw RuntimeInstallException(
                        "E_BAD_MANIFEST",
                        "manifest is missing $key"
                    )

            fun int(key: String, fallback: Int? = null): Int =
                root[key]?.jsonPrimitive?.intOrNull ?: fallback
                ?: throw RuntimeInstallException("E_BAD_MANIFEST", "manifest is missing $key")

            val artifact = root["artifact"] as? JsonObject
                ?: throw RuntimeInstallException("E_BAD_MANIFEST", "manifest is missing artifact")
            val install = root["install"] as? JsonObject
                ?: throw RuntimeInstallException("E_BAD_MANIFEST", "manifest is missing install")
            val envObj = root["env"] as? JsonObject ?: JsonObject(emptyMap())
            val health = root["healthCheck"] as? JsonObject

            fun artifactStr(key: String): String =
                artifact[key]?.jsonPrimitive?.contentOrNull
                    ?: throw RuntimeInstallException(
                        "E_BAD_MANIFEST",
                        "manifest artifact is missing $key"
                    )

            val abi = (root["abi"] as? JsonArray)
                ?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
            val healthArgv = (health?.get("argv") as? JsonArray)
                ?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()
            val executables = (install["executables"] as? JsonArray)
                ?.mapNotNull { it.jsonPrimitive.contentOrNull } ?: emptyList()

            val size = artifactStr("size").toLongOrNull()
                ?: throw RuntimeInstallException(
                    "E_BAD_MANIFEST",
                    "manifest artifact size is malformed"
                )

            val manifest = RuntimeManifest(
                schema = int("schema", SCHEMA),
                id = str("id"),
                version = str("version"),
                versionCode = int("versionCode", 1),
                abi = abi,
                minAndroid = int("minAndroid", 28),
                url = artifactStr("url"),
                sha256 = artifactStr("sha256"),
                size = size,
                installedSize = install["installedSize"]?.jsonPrimitive?.contentOrNull
                    ?.toLongOrNull() ?: (size * 4),
                layout = install["layout"]?.jsonPrimitive?.contentOrNull ?: "prefix",
                strip = install["strip"]?.jsonPrimitive?.intOrNull ?: 0,
                prefix = install["prefix"]?.jsonPrimitive?.contentOrNull ?: "prefix",
                executables = executables,
                env = envObj.mapValues { it.value.jsonPrimitive.contentOrNull ?: "" },
                healthArgv = healthArgv,
                healthTimeoutMs = health?.get("timeoutMs")?.jsonPrimitive?.contentOrNull
                    ?.toLongOrNull() ?: 30_000
            )

            manifest.validate(expectedId)
            return manifest
        }
    }

    private fun validate(expectedId: String?) {
        if (!ID.matches(id)) {
            throw RuntimeInstallException("E_BAD_MANIFEST", "invalid runtime id: $id")
        }
        if (expectedId != null && id != expectedId) {
            throw RuntimeInstallException(
                "E_BAD_MANIFEST",
                "manifest id mismatch: $expectedId vs $id"
            )
        }
        if (schema > SCHEMA) {
            throw RuntimeInstallException(
                "E_BAD_MANIFEST",
                "this manifest needs a newer LeoCode (schema $schema)"
            )
        }
        if (!url.startsWith("https://")) {
            throw RuntimeInstallException("E_BAD_MANIFEST", "artifact URL must be https")
        }
        if (!SHA256.matches(sha256)) {
            throw RuntimeInstallException(
                "E_BAD_MANIFEST",
                "artifact sha256 is missing or malformed"
            )
        }
        if (size <= 0 || installedSize <= 0) {
            throw RuntimeInstallException("E_BAD_MANIFEST", "artifact size is missing")
        }
        if (versionCode <= 0) {
            throw RuntimeInstallException("E_BAD_MANIFEST", "versionCode must be positive")
        }
        if (strip < 0 || strip > 4) {
            throw RuntimeInstallException("E_BAD_MANIFEST", "strip must be 0..4")
        }
        if (layout != "prefix") {
            throw RuntimeInstallException(
                "E_UNSUPPORTED",
                "unsupported install layout: $layout"
            )
        }
        if (healthArgv.isEmpty()) {
            throw RuntimeInstallException(
                "E_BAD_MANIFEST",
                "manifest has no health check command"
            )
        }
        if (executables.isEmpty()) {
            throw RuntimeInstallException(
                "E_BAD_MANIFEST",
                "manifest lists no executables"
            )
        }
    }
}
