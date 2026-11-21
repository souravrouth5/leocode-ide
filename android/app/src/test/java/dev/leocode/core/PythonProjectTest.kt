package dev.leocode.core

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PythonProjectTest {

    private fun workspace(): Pair<Workspace, File> {
        val root = Files.createTempDirectory("leocode-python").toFile().also { it.deleteOnExit() }
        val workspace = Workspace(root)
        workspace.ensure()
        return workspace to root
    }

    @Test
    fun `aliases point at python3 and pip3`() {
        val (workspace, _) = workspace()
        val bin = File(workspace.usr, "bin").apply { mkdirs() }
        File(bin, "python3").writeText("")
        File(bin, "pip3").writeText("")
        val project = File(workspace.workspacesRoot, "default").apply { mkdirs() }

        assertTrue(PythonProject(workspace, project).ensureAliases())
        assertEquals("python3", Files.readSymbolicLink(File(bin, "python").toPath()).toString())
        assertEquals("pip3", Files.readSymbolicLink(File(bin, "pip").toPath()).toString())
    }

    @Test
    fun `status reports the runtime, venv and requirements state`() {
        val (workspace, _) = workspace()
        val bin = File(workspace.usr, "bin").apply { mkdirs() }
        File(bin, "python3").apply {
            writeText("")
            setExecutable(true)
        }
        val project = File(workspace.workspacesRoot, "default").apply { mkdirs() }
        val python = PythonProject(workspace, project)

        var status = python.status()
        assertTrue(status.runtimeInstalled)
        assertFalse(status.venvExists)
        assertFalse(status.requirementsExists)

        File(project, "requirements.txt").writeText("requests\n")
        File(python.venv, "bin").mkdirs()
        File(python.venvPython.path).apply {
            writeText("")
            setExecutable(true)
        }
        status = python.status()
        assertTrue(status.venvExists)
        assertTrue(status.requirementsExists)
        assertFalse(status.requirementsInstalled)

        val hash = python.requirementsHash()!!
        python.markRequirementsInstalled(hash)
        assertTrue(python.status().requirementsInstalled)

        File(project, "requirements.txt").writeText("requests\nrich\n")
        assertFalse("an edited requirements.txt is not installed", python.status().requirementsInstalled)
    }

    @Test
    fun `removeVenv deletes only the project environment`() {
        val (workspace, _) = workspace()
        val project = File(workspace.workspacesRoot, "default").apply { mkdirs() }
        val keep = File(project, "main.py").apply { writeText("print(1)\n") }
        val venv = File(project, ".venv/lib").apply { mkdirs() }
        File(venv, "package.py").writeText("x = 1\n")
        val python = PythonProject(workspace, project)

        python.removeVenv()

        assertFalse(python.venv.exists())
        assertTrue(keep.isFile)
    }
}
