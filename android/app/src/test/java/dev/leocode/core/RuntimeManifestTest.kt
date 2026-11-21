package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeManifestTest {

    private fun json(
        id: String = "python",
        schema: Int = 1,
        url: String = "https://www.python.org/ftp/python/3.14.10/python.tar.gz",
        sha256: String = "a".repeat(64),
        strip: Int = 1,
        health: String = """["bin/python3","-c","print(1)"]"""
    ) = """
        {
          "schema": $schema,
          "id": "$id",
          "version": "3.14.10",
          "versionCode": 31410,
          "abi": ["arm64-v8a"],
          "minAndroid": 28,
          "artifact": {
            "url": "$url",
            "sha256": "$sha256",
            "size": 23027305
          },
          "install": {
            "layout": "prefix",
            "strip": $strip,
            "executables": ["bin/python3"]
          },
          "env": { "PYTHONHOME": "{{prefix}}" },
          "healthCheck": { "argv": $health, "timeoutMs": 30000 }
        }
    """.trimIndent()

    @Test
    fun `parses the fields the installer needs`() {
        val manifest = RuntimeManifest.parse(json(), "python")

        assertEquals("python", manifest.id)
        assertEquals(31410, manifest.versionCode)
        assertEquals(23_027_305L, manifest.size)
        assertEquals(23_027_305L * 4, manifest.installedSize)
        assertEquals(listOf("bin/python3"), manifest.executables)
        assertEquals("{{prefix}}", manifest.env["PYTHONHOME"])
        assertEquals(30_000L, manifest.healthTimeoutMs)
    }

    @Test
    fun `an explicit installedSize wins`() {
        val text = json().replace(
            """"strip": 1,""",
            """"strip": 1, "installedSize": 123456,"""
        )
        assertEquals(123_456L, RuntimeManifest.parse(text).installedSize)
    }

    @Test
    fun `rejects a malformed sha256`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeManifest.parse(json(sha256 = "xyz"))
        }
        assertEquals("E_BAD_MANIFEST", error.code)
    }

    @Test
    fun `rejects a plain http artifact`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeManifest.parse(json(url = "http://example.test/python.tar.gz"))
        }
        assertEquals("E_BAD_MANIFEST", error.code)
    }

    @Test
    fun `rejects an id mismatch`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeManifest.parse(json(id = "python"), "node")
        }
        assertEquals("E_BAD_MANIFEST", error.code)
    }

    @Test
    fun `rejects a newer schema`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeManifest.parse(json(schema = 2))
        }
        assertEquals("E_BAD_MANIFEST", error.code)
    }

    @Test
    fun `rejects an absurd strip count`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeManifest.parse(json(strip = 9))
        }
        assertEquals("E_BAD_MANIFEST", error.code)
    }

    @Test
    fun `rejects a manifest without a health check`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeManifest.parse(json(health = "[]"))
        }
        assertEquals("E_BAD_MANIFEST", error.code)
    }

    @Test
    fun `rejects invalid json`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeManifest.parse("{not json")
        }
        assertEquals("E_BAD_MANIFEST", error.code)
        assertTrue(error.message!!.contains("JSON"))
    }
}
