package dev.leocode.core

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TrustStoreTest {

    private fun tempDir(): File =
        Files.createTempDirectory("leocode-trust").toFile().also { it.deleteOnExit() }

    @Test
    fun `a grant is remembered for the same fingerprint only`() {
        val dir = tempDir()
        val store = TrustStore(File(dir, "trust.json"))
        val project = File(dir, "project").apply { mkdirs() }
        val script = File(project, "main.py").apply { writeText("print(1)\n") }
        val fingerprint = TrustFingerprint.compute(project, TrustAction.SCRIPT, "main.py")

        assertFalse(store.check(project.path, TrustAction.SCRIPT, fingerprint))
        store.grant(project.path, TrustAction.SCRIPT, fingerprint)
        assertTrue(store.check(project.path, TrustAction.SCRIPT, fingerprint))

        script.writeText("print(2)\n")
        val changed = TrustFingerprint.compute(project, TrustAction.SCRIPT, "main.py")
        assertFalse("an edited script must ask again", store.check(project.path, TrustAction.SCRIPT, changed))
    }

    @Test
    fun `actions are independent`() {
        val dir = tempDir()
        val store = TrustStore(File(dir, "trust.json"))
        val project = File(dir, "project").apply { mkdirs() }
        val fingerprint = TrustFingerprint.compute(project, TrustAction.PIP)
        store.grant(project.path, TrustAction.PIP, fingerprint)

        assertTrue(store.check(project.path, TrustAction.PIP, fingerprint))
        assertFalse(store.check(project.path, TrustAction.SCRIPT, fingerprint))
    }

    @Test
    fun `revoke removes one action or the whole project`() {
        val dir = tempDir()
        val store = TrustStore(File(dir, "trust.json"))
        val project = File(dir, "project").apply { mkdirs() }
        val pip = TrustFingerprint.compute(project, TrustAction.PIP)
        val venv = TrustFingerprint.compute(project, TrustAction.VENV, extra = "runtime")
        store.grant(project.path, TrustAction.PIP, pip)
        store.grant(project.path, TrustAction.VENV, venv)

        store.revoke(project.path, TrustAction.PIP)
        assertFalse(store.check(project.path, TrustAction.PIP, pip))
        assertTrue(store.check(project.path, TrustAction.VENV, venv))

        store.revoke(project.path)
        assertFalse(store.check(project.path, TrustAction.VENV, venv))
        assertEquals(0, store.list().size)
    }

    @Test
    fun `a corrupt index trusts nothing instead of failing every run`() {
        val dir = tempDir()
        val file = File(dir, "trust.json").apply { writeText("{not json") }
        val store = TrustStore(file)
        val project = File(dir, "project").apply { mkdirs() }
        assertFalse(store.check(project.path, TrustAction.SCRIPT, "sha256:x"))
    }

    @Test
    fun `requirements fingerprint follows the file content`() {
        val dir = tempDir()
        val project = File(dir, "project").apply { mkdirs() }
        val requirements = File(project, "requirements.txt")

        val empty = TrustFingerprint.compute(project, TrustAction.PIP)
        requirements.writeText("requests\n")
        val withRequests = TrustFingerprint.compute(project, TrustAction.PIP)
        requirements.writeText("requests\nrich\n")
        val withRich = TrustFingerprint.compute(project, TrustAction.PIP)

        assertFalse(empty == withRequests)
        assertFalse(withRequests == withRich)
    }

    @Test
    fun `git hooks fingerprint ignores samples`() {
        val dir = tempDir()
        val project = File(dir, "project").apply { mkdirs() }
        val hooks = File(project, ".git/hooks").apply { mkdirs() }
        File(hooks, "pre-commit.sample").writeText("sample\n")
        val before = TrustFingerprint.compute(project, TrustAction.GIT_HOOKS)
        File(hooks, "pre-commit").writeText("#!/bin/sh\necho hi\n")
        val after = TrustFingerprint.compute(project, TrustAction.GIT_HOOKS)

        assertFalse(before == after)
    }
}
