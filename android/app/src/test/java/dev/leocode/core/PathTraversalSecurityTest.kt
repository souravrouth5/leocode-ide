package dev.leocode.core

import dev.leocode.bridge.BridgeException
import dev.leocode.bridge.BridgeJson
import dev.leocode.bridge.ErrorCode
import dev.leocode.bridge.FsHandler
import java.io.File
import java.net.URLDecoder
import java.nio.file.Files
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeNoException
import org.junit.Before
import org.junit.Test

/**
 * Security test suite for path traversal and filesystem jail boundaries (Task 29).
 *
 * Validates that [PathJail] and [FsHandler] reject arbitrary directory traversal attacks,
 * URL-encoded paths, null-byte injections, prefix collisions, symlink escapes, and system paths.
 * Every traversal attempt must throw a [BridgeException] with [ErrorCode.E_PATH_OUTSIDE_ROOT].
 */
class PathTraversalSecurityTest {

    private lateinit var tempParent: File
    private lateinit var workspaceDir: File
    private lateinit var workspace: Workspace
    private lateinit var jail: PathJail
    private lateinit var trash: Trash
    private lateinit var fsHandler: FsHandler

    @Before
    fun setUp() {
        tempParent = createTempDir("leocode-sec-test")
        workspaceDir = File(tempParent, "workspaces").apply { mkdirs() }
        workspace = Workspace(workspaceDir).apply { ensure() }
        // The jail enforces that all accesses stay strictly under workspace.workspacesRoot
        jail = PathJail(workspace.workspacesRoot, sharedStorageRoot = null) { false }
        trash = Trash(File(workspace.root, ".trash"))
        // fsHandler activeRoot points to workspacesRoot so any traversal outside it is trapped
        fsHandler = FsHandler(
            workspace = workspace,
            jail = jail,
            trash = trash,
            json = BridgeJson.value,
            activeRoot = { workspace.workspacesRoot }
        )
    }

    private fun assertOutsideRoot(block: () -> Unit) {
        try {
            block()
            fail("Expected BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT), but no exception was thrown")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_PATH_OUTSIDE_ROOT, e.errorCode)
        }
    }

    private fun assertJailRejection(rawPath: String) {
        // Direct PathJail resolve check: must throw SecurityException
        try {
            jail.resolve(rawPath, workspace.workspacesRoot)
            fail("PathJail.resolve accepted traversal path: $rawPath")
        } catch (_: SecurityException) {
            // expected
        }

        // Bridge handler check: must throw BridgeException(E_PATH_OUTSIDE_ROOT)
        assertOutsideRoot {
            fsHandler.handle("fs.read", buildJsonObject { put("path", rawPath) })
        }
        assertOutsideRoot {
            fsHandler.handle("fs.list", buildJsonObject { put("path", rawPath) })
        }
        assertOutsideRoot {
            fsHandler.handle("fs.stat", buildJsonObject { put("path", rawPath) })
        }
    }

    @Test
    fun `classic path traversals are rejected`() {
        val traversals = listOf(
            "../",
            "../outside.txt",
            "../../",
            "../../secrets.env",
            "foo/../../bar",
            "a/b/../../../etc/passwd",
            "dir/../../../../etc/shadow",
            "nested/sub/../../../../../../../../../../tmp"
        )

        for (path in traversals) {
            assertJailRejection(path)
        }
    }

    @Test
    fun `backslash and redundant slash traversals are rejected`() {
        val patterns = listOf(
            "..//",
            "..//outside.txt",
            "foo/..//../bar",
            "foo/../../",
            "a//b/../../../../secrets"
        )

        for (path in patterns) {
            assertJailRejection(path)
        }

        // Backslash traversal normalized or tested on Windows-style sequences
        val backslashTraversals = listOf(
            "..\\",
            "..\\outside.txt",
            "foo\\..\\..\\bar",
            "....//..//..//outside"
        )
        for (bsPath in backslashTraversals) {
            val normalized = bsPath.replace('\\', '/')
            assertJailRejection(normalized)
        }
    }

    @Test
    fun `url encoded traversals are rejected or confined`() {
        val encodedAttacks = listOf(
            "%2e%2e%2f",
            "%252e%252e%252f",
            "%2e%2e%2f%2e%2e%2f",
            "%2e%2e/../../secrets",
            "..%2f..%2fetc%2fpasswd",
            "%2e%2e%5c",
            "%252e%252e%255c"
        )

        for (attack in encodedAttacks) {
            // Decoded payload simulation: Web/HTTP layer decoding
            val decodedOnce = runCatching { URLDecoder.decode(attack, "UTF-8") }.getOrDefault(attack)
            val decodedTwice = runCatching { URLDecoder.decode(decodedOnce, "UTF-8") }.getOrDefault(decodedOnce)
            val normalized = decodedTwice.replace('\\', '/')

            if (normalized.contains("..")) {
                val candidate = if (normalized.endsWith("/")) normalized + "secret" else normalized
                assertJailRejection(candidate)
            }

            // Raw string evaluation: if PathJail processes it raw without throwing,
            // it must remain strictly within the jail root and never resolve outside.
            try {
                val resolved = jail.resolve(attack, workspace.workspacesRoot)
                assertTrue("Resolved path escaped jail: $resolved", jail.isAllowed(resolved))
                val wsPath = workspace.workspacesRoot.canonicalPath
                val prefix = if (wsPath.endsWith(File.separator)) wsPath else wsPath + File.separator
                assertTrue(resolved.canonicalPath == wsPath || resolved.canonicalPath.startsWith(prefix))
            } catch (_: SecurityException) {
                // If PathJail rejects it directly, verify FsHandler throws E_PATH_OUTSIDE_ROOT
                assertOutsideRoot {
                    fsHandler.handle("fs.read", buildJsonObject { put("path", attack) })
                }
            }
        }
    }

    @Test
    fun `null byte injections are rejected`() {
        val nullByteAttacks = listOf(
            "file.txt\u0000.png",
            "\u0000../secrets",
            "foo\u0000bar.txt",
            "default/notes.txt\u0000/../../etc/passwd",
            "\u0000"
        )

        for (attack in nullByteAttacks) {
            // PathJail.resolve must throw SecurityException("path contains NUL")
            try {
                jail.resolve(attack, workspace.workspacesRoot)
                fail("PathJail.resolve accepted null byte: $attack")
            } catch (e: SecurityException) {
                assertTrue(e.message?.contains("NUL") == true || e.message?.contains("outside") == true)
            }

            // PathJail.resolveEntry must throw SecurityException("path contains NUL")
            try {
                jail.resolveEntry(attack, workspace.workspacesRoot)
                fail("PathJail.resolveEntry accepted null byte: $attack")
            } catch (e: SecurityException) {
                assertTrue(e.message?.contains("NUL") == true || e.message?.contains("outside") == true)
            }

            // FsHandler methods must throw BridgeException(E_PATH_OUTSIDE_ROOT)
            assertOutsideRoot {
                fsHandler.handle("fs.read", buildJsonObject { put("path", attack) })
            }
            assertOutsideRoot {
                fsHandler.handle("fs.delete", buildJsonObject { put("path", attack) })
            }
            assertOutsideRoot {
                fsHandler.handle("fs.write", buildJsonObject {
                    put("path", attack)
                    put("content", "test")
                })
            }
        }
    }

    @Test
    fun `prefix collision attack is rejected`() {
        val base = tempParent
        val devLeocode = File(base, "dev.leocode").apply { mkdirs() }
        val devLeocodeX = File(base, "dev.leocodeX").apply { mkdirs() }
        val secretFile = File(devLeocodeX, "passwords.txt").apply { writeText("secret") }

        val collisionJail = PathJail(devLeocode)

        assertFalse("dev.leocodeX must not be allowed under dev.leocode root", collisionJail.isAllowed(secretFile))

        try {
            collisionJail.resolve(secretFile.absolutePath)
            fail("Prefix collision directory was accepted")
        } catch (_: SecurityException) {
            // expected
        }

        val collisionWs = Workspace(devLeocode).apply { ensure() }
        val collisionHandler = FsHandler(
            workspace = collisionWs,
            jail = collisionJail,
            trash = Trash(File(devLeocode, ".trash")),
            json = BridgeJson.value,
            activeRoot = { devLeocode }
        )

        assertOutsideRoot {
            collisionHandler.handle("fs.read", buildJsonObject { put("path", secretFile.absolutePath) })
        }
    }

    @Test
    fun `symlink escaping outside jail is rejected`() {
        val outsideDir = createTempDir("outside-jail")
        val secretFile = File(outsideDir, "secret.txt").apply { writeText("supersecret") }

        val escapeLink = File(workspace.workspacesRoot, "escape_link")
        try {
            Files.createSymbolicLink(escapeLink.toPath(), secretFile.toPath())
        } catch (e: Exception) {
            assumeNoException("Symlinks not supported on filesystem", e)
        }

        // Resolving the symlink resolves to the canonical target outside the root
        try {
            jail.resolve("escape_link", workspace.workspacesRoot)
            fail("Symlink escape was accepted by PathJail")
        } catch (_: SecurityException) {
            // expected
        }

        assertOutsideRoot {
            fsHandler.handle("fs.read", buildJsonObject { put("path", "escape_link") })
        }
        assertOutsideRoot {
            fsHandler.handle("fs.stat", buildJsonObject { put("path", "escape_link") })
        }
    }

    @Test
    fun `absolute system paths are rejected`() {
        val systemPaths = listOf(
            "/system/build.prop",
            "/data/system/",
            "/proc/cpuinfo",
            "/proc/version",
            "/etc/passwd",
            "/etc/shadow",
            "/sys/class",
            "/dev/null"
        )

        for (sysPath in systemPaths) {
            assertJailRejection(sysPath)
        }
    }

    @Test
    fun `resolveEntry prevents outside rename and delete operations`() {
        val outsideDir = createTempDir("outside-entry")
        val outsideFile = File(outsideDir, "file.txt").apply { writeText("target") }

        assertOutsideRoot {
            fsHandler.handle(
                "fs.rename",
                buildJsonObject {
                    put("from", outsideFile.absolutePath)
                    put("to", "local.txt")
                }
            )
        }

        assertOutsideRoot {
            fsHandler.handle(
                "fs.rename",
                buildJsonObject {
                    put("from", "valid.txt")
                    put("to", outsideFile.absolutePath)
                }
            )
        }

        assertOutsideRoot {
            fsHandler.handle(
                "fs.delete",
                buildJsonObject {
                    put("path", outsideFile.absolutePath)
                }
            )
        }
    }
}
