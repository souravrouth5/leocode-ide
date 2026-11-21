package dev.leocode.core

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The manifest and its signature ship inside the APK, so a stale signature is a
 * build bug that would make every install fail on a device. This test fails the
 * build instead.
 */
class BundledManifestTest {

    private fun assetsDir(): File =
        listOf(
            File("src/main/assets/runtime"),
            File("android/app/src/main/assets/runtime")
        ).first { it.isDirectory }

    @Test
    fun `the bundled python manifest is signed with the compiled key`() {
        val dir = assetsDir()
        val manifest = File(dir, "python.json")
        val signature = File(dir, "python.json.sig")
        assertTrue("python.json is missing", manifest.isFile)
        assertTrue("python.json.sig is missing; run scripts/sign-manifest.sh", signature.isFile)

        val verifier = ManifestVerifier(RuntimeKeys.PYTHON)
        assertTrue(
            "the bundled manifest signature does not match RuntimeKeys.PYTHON",
            verifier.verify(manifest.readBytes(), signature.readText())
        )
    }

    @Test
    fun `the bundled python manifest parses and pins an https artifact`() {
        val parsed = RuntimeManifest.parse(
            File(assetsDir(), "python.json").readText(),
            "python"
        )

        assertEquals("python", parsed.id)
        assertEquals(31_410, parsed.versionCode)
        assertTrue(parsed.url.startsWith("https://"))
        assertEquals(64, parsed.sha256.length)
        assertTrue(parsed.installedSize >= parsed.size)
        assertTrue(parsed.executables.contains("bin/python3"))
    }
}
