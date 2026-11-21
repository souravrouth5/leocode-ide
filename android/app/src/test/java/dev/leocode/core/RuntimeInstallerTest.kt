package dev.leocode.core

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RuntimeInstallerTest {

    private val prefix = File("/data/user/0/dev.leocode/files/usr")

    @Test
    fun `resolves a relative executable against the runtime prefix`() {
        assertEquals(
            listOf(
                File(prefix, "bin/python3").path,
                "-c",
                "print(1)"
            ),
            RuntimeInstaller.resolveCommand(
                prefix,
                listOf("bin/python3", "-c", "print(1)")
            )
        )
    }

    @Test
    fun `keeps an absolute executable`() {
        val argv = listOf("/system/bin/sh", "-c", "true")
        assertEquals(argv, RuntimeInstaller.resolveCommand(prefix, argv))
    }

    @Test
    fun `leaves a bare command for the OS to find on PATH`() {
        val argv = listOf("sh", "-c", "true")
        assertEquals(argv, RuntimeInstaller.resolveCommand(prefix, argv))
    }

    @Test
    fun `handles an empty command list`() {
        assertEquals(emptyList<String>(), RuntimeInstaller.resolveCommand(prefix, emptyList()))
    }

    private fun manifest(vararg executables: String) = RuntimeManifest(
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
        executables = executables.toList(),
        env = emptyMap(),
        healthArgv = listOf("bin/tool"),
        healthTimeoutMs = 1_000
    )

    @Test
    fun `accepts an executable the installer placed`() {
        val root = Files.createTempDirectory("leocode-installer").toFile()
        val tool = File(root, "bin/tool").apply {
            parentFile.mkdirs()
            writeText("#!/bin/sh\n")
        }

        RuntimeInstaller.verifyExecutables(manifest("bin/tool"), root)

        assertTrue(tool.canExecute())
    }

    @Test
    fun `rejects a manifest executable that is missing`() {
        val root = Files.createTempDirectory("leocode-installer").toFile()
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeInstaller.verifyExecutables(manifest("bin/tool"), root)
        }
        assertEquals("E_INTEGRITY", error.code)
    }

    @Test
    fun `rejects an executable path that escapes the prefix`() {
        val root = Files.createTempDirectory("leocode-installer").toFile()
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeInstaller.verifyExecutables(manifest("../escape"), root)
        }
        assertEquals("E_BAD_MANIFEST", error.code)
    }

    @Test
    fun `normalizes a manifest path`() {
        assertEquals("bin/python3", RuntimeInstaller.normalizeRelative("./bin//python3"))
        val error = assertThrows(RuntimeInstallException::class.java) {
            RuntimeInstaller.normalizeRelative("bin/../python3")
        }
        assertEquals("E_BAD_MANIFEST", error.code)
    }
}
