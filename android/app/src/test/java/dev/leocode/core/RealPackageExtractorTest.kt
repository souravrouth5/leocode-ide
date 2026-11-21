package dev.leocode.core

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Extracts the real pinned artifact when it is available locally, so the
 * zip-slip/pruning rules are exercised against the bytes we ship, not only
 * synthetic archives.
 *
 *   LEOCODE_PYTHON_ARTIFACT=/tmp/python-3.14.10-android.tar.gz \
 *       ./gradlew testDebugUnitTest --tests 'dev.leocode.core.RealPackageExtractorTest'
 *
 * CI has no artifact in the unit-test job, so the test is skipped there.
 */
class RealPackageExtractorTest {

    private fun assetsDir(): File =
        listOf(
            File("src/main/assets/runtime"),
            File("android/app/src/main/assets/runtime")
        ).first { it.isDirectory }

    @Test
    fun `the pinned python package extracts to a usable prefix`() {
        val path = System.getenv("LEOCODE_PYTHON_ARTIFACT")
        assumeTrue("LEOCODE_PYTHON_ARTIFACT is not set", !path.isNullOrBlank())
        val artifact = File(path!!)
        assumeTrue("$path does not exist", artifact.isFile)

        val manifest = RuntimeManifest.parse(
            File(assetsDir(), "python.json").readText(),
            "python"
        )
        assertEquals(artifact.length(), manifest.size)

        val destination = Files.createTempDirectory("leocode-real-python").toFile()
        val result = SafeExtractor().extract(artifact, destination, manifest)

        // 3176 entries in ./prefix; the test suite, headers and pkgconfig are
        // pruned, leaving a little under a thousand files.
        assertTrue("files=${result.files}", result.files > 800)
        assertTrue("bytes=${result.bytes}", result.bytes > 40L * 1024 * 1024)
        assertTrue(File(destination, "lib/libpython3.14.so").isFile)
        assertTrue(File(destination, "lib/python3.14/os.py").isFile)
        assertTrue(File(destination, "lib/python3.14/ensurepip/_bundled").isDirectory)
        assertTrue(File(destination, "lib/python3.14/lib-dynload/_ssl.cpython-314-aarch64-linux-android.so").isFile)

        // Build leftovers and the test suite are pruned.
        assertFalse(File(destination, "include").exists())
        assertFalse(File(destination, "lib/python3.14/test").exists())
        assertFalse(File(destination, "testbed").exists())
        assertFalse(File(destination, "README.md").exists())

        // The official package has no executable; the installer adds one.
        assertFalse(File(destination, "bin/python3").exists())
    }
}
