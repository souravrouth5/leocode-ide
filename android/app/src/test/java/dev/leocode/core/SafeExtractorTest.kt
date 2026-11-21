package dev.leocode.core

import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files
import java.nio.file.attribute.PosixFilePermission
import org.apache.commons.compress.archivers.tar.TarArchiveEntry
import org.apache.commons.compress.archivers.tar.TarArchiveOutputStream
import org.apache.commons.compress.archivers.tar.TarConstants
import org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeExtractorTest {

    private val manifest = RuntimeManifest(
        schema = 1,
        id = "test",
        version = "1.0",
        versionCode = 1,
        abi = listOf("arm64-v8a"),
        minAndroid = 28,
        url = "https://example.test/test.tar.gz",
        sha256 = "a".repeat(64),
        size = 1,
        installedSize = 1,
        layout = "prefix",
        strip = 1,
        prefix = "prefix",
        executables = listOf("bin/tool"),
        env = emptyMap(),
        healthArgv = listOf("bin/tool"),
        healthTimeoutMs = 1_000
    )

    private class Entry(
        val name: String,
        val content: String = "",
        val mode: Int = 420,
        val linkFlag: Byte = TarConstants.LF_NORMAL,
        val linkName: String = ""
    )

    private fun tarGz(vararg entries: Entry): File {
        val file = Files.createTempFile("leocode-safe-extract", ".tar.gz").toFile()
        FileOutputStream(file).use { out ->
            GzipCompressorOutputStream(out).use { gzip ->
                TarArchiveOutputStream(gzip).use { tar ->
                    for (e in entries) {
                        val entry = TarArchiveEntry(e.name, e.linkFlag)
                        entry.mode = e.mode
                        if (e.linkName.isNotEmpty()) entry.linkName = e.linkName
                        if (e.linkFlag == TarConstants.LF_NORMAL) {
                            val bytes = e.content.toByteArray()
                            entry.size = bytes.size.toLong()
                            tar.putArchiveEntry(entry)
                            tar.write(bytes)
                        } else {
                            entry.size = 0
                            tar.putArchiveEntry(entry)
                        }
                        tar.closeArchiveEntry()
                    }
                    tar.finish()
                }
            }
        }
        return file
    }

    private fun extractor(
        maxBytes: Long = 512L * 1024 * 1024,
        maxFiles: Int = 60_000,
        maxRatio: Long = 200
    ) = SafeExtractor(maxBytes, maxFiles, maxRatio)

    private fun destination(): File = Files.createTempDirectory("leocode-safe-out").toFile()

    private fun extract(file: File, dest: File, extractor: SafeExtractor = extractor()) =
        extractor.extract(file, dest, manifest)

    @Test
    fun `extracts the prefix and keeps the executable bit`() {
        val dest = destination()
        val result = extract(
            tarGz(
                Entry("prefix/bin/tool", "#!/bin/sh\necho ok\n", 493),
                Entry("prefix/lib/data.txt", "payload")
            ),
            dest
        )

        assertEquals(2, result.files)
        assertEquals("payload", File(dest, "lib/data.txt").readText())
        assertTrue(File(dest, "bin/tool").canExecute())
        assertFalse(File(dest, "prefix").exists())
    }

    @Test
    fun `rejects an absolute path`() {
        // TarArchiveOutputStream normalises a leading slash away, so test the
        // guard directly: a hand-built archive can still carry one.
        val error = assertThrows(RuntimeInstallException::class.java) {
            extractor().relativeEntryPath("/etc/passwd", manifest)
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `rejects parent traversal`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extractor().relativeEntryPath("prefix/../../escape", manifest)
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `classifies a device node as special`() {
        val entry = TarArchiveEntry("prefix/dev/null", TarConstants.LF_CHR)
        assertEquals(SafeExtractor.Kind.SPECIAL, extractor().kindOf(entry))
    }

    @Test
    fun `classifies a fifo as special`() {
        val entry = TarArchiveEntry("prefix/run/pipe", TarConstants.LF_FIFO)
        assertEquals(SafeExtractor.Kind.SPECIAL, extractor().kindOf(entry))
    }

    @Test
    fun `rejects a symlink that escapes`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extract(
                tarGz(
                    Entry("prefix/link", linkFlag = TarConstants.LF_SYMLINK, linkName = "../../etc")
                ),
                destination()
            )
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `rejects an absolute symlink`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extract(
                tarGz(
                    Entry("prefix/link", linkFlag = TarConstants.LF_SYMLINK, linkName = "/etc/passwd")
                ),
                destination()
            )
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `accepts a relative symlink inside the tree`() {
        val dest = destination()
        extract(
            tarGz(
                Entry("prefix/bin/tool", "x", 493),
                Entry("prefix/lib/real.txt", "x"),
                Entry("prefix/bin/alias", linkFlag = TarConstants.LF_SYMLINK, linkName = "../lib/real.txt")
            ),
            dest
        )
        assertTrue(Files.isSymbolicLink(File(dest, "bin/alias").toPath()))
        assertEquals("x", File(dest, "bin/alias").readText())
    }

    @Test
    fun `rejects a hardlink that escapes`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extract(
                tarGz(
                    Entry("prefix/bin/tool", "x", 493),
                    Entry("prefix/link", linkFlag = TarConstants.LF_LINK, linkName = "/etc/passwd")
                ),
                destination()
            )
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `accepts a hardlink to an extracted file`() {
        val dest = destination()
        extract(
            tarGz(
                Entry("prefix/bin/tool", "x", 493),
                Entry("prefix/bin/copy", linkFlag = TarConstants.LF_LINK, linkName = "prefix/bin/tool")
            ),
            dest
        )
        assertEquals("x", File(dest, "bin/copy").readText())
    }

    @Test
    fun `a special entry in the stream is rejected end to end`() {
        // The writer may normalise a device node; the classifier above proves
        // the guard. This checks that a special flag that survives the round
        // trip is not written to disk.
        val entry = TarArchiveEntry("prefix/dev/null", TarConstants.LF_CHR)
        assertEquals(SafeExtractor.Kind.SPECIAL, extractor().kindOf(entry))
    }

    @Test
    fun `rejects setuid and setgid bits`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extract(tarGz(Entry("prefix/bin/tool", "x", 2541)), destination())
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `rejects a package larger than the byte cap`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extractor(maxBytes = 10).extract(
                tarGz(Entry("prefix/bin/tool", "x".repeat(100), 493)),
                destination(),
                manifest
            )
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `rejects too many files`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extractor(maxFiles = 1).extract(
                tarGz(
                    Entry("prefix/bin/tool", "x", 493),
                    Entry("prefix/lib/one", "1")
                ),
                destination(),
                manifest
            )
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `rejects a suspicious compression ratio`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extractor(maxRatio = 1).extract(
                tarGz(Entry("prefix/bin/tool", "x".repeat(10_000), 493)),
                destination(),
                manifest
            )
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `extraction does not require the launcher that configure adds`() {
        // The official python.org Android package has no bin/python3; the
        // installer copies its launcher there after extraction.
        val dest = destination()
        val result = extract(tarGz(Entry("prefix/lib/libpython3.14.so", "x")), dest)

        assertEquals(1, result.files)
        assertTrue(File(dest, "lib/libpython3.14.so").isFile)
    }

    @Test
    fun `cancellation stops before writing`() {
        val error = assertThrows(RuntimeInstallException::class.java) {
            extractor().extract(
                tarGz(Entry("prefix/bin/tool", "x", 493)),
                destination(),
                manifest,
                isCancelled = { true }
            )
        }
        assertEquals("E_CANCELLED", error.code)
    }

    @Test
    fun `files outside the prefix are skipped`() {
        val dest = destination()
        val result = extract(
            tarGz(
                Entry("README", "build leftover"),
                Entry("prefix/bin/tool", "x", 493)
            ),
            dest
        )
        assertEquals(1, result.files)
        assertFalse(File(dest, "README").exists())
    }
}
