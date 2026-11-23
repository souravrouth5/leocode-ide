package dev.leocode.core.language

import dev.leocode.bridge.BridgeException
import dev.leocode.bridge.ErrorCode
import dev.leocode.core.Workspace
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class PythonLanguageProviderTest {

    @get:Rule
    val temp = TemporaryFolder()

    @Test
    fun `descriptor adheres to contract`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val provider = PythonLanguageProvider(workspace)

        val desc = provider.descriptor()
        assertEquals("python", desc.id)
        assertEquals("Python", desc.displayName)
        assertEquals(listOf("py"), desc.extensions)
        assertEquals("python", desc.runtimeId)
        assertTrue(desc.supportsRepl ?: false)
        assertTrue(desc.requiresRuntime ?: false)
        assertEquals(listOf("script", "venv", "pip"), desc.trustTriggers)
        assertTrue(desc.templateFiles?.contains("main.py") == true)
    }

    @Test
    fun `project template creates standard files`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val provider = PythonLanguageProvider(workspace)

        val template = provider.projectTemplate()
        assertNotNull(template)
        val paths = template!!.files.map { it.path }
        assertTrue("main.py in template", paths.contains("main.py"))
        assertTrue("requirements.txt in template", paths.contains("requirements.txt"))
        assertTrue(".gitignore in template", paths.contains(".gitignore"))
        assertTrue("README.md in template", paths.contains("README.md"))
    }

    @Test
    fun `traceback parser extracts frames correctly`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val provider = PythonLanguageProvider(workspace)

        val output = """
            Traceback (most recent call last):
              File "main.py", line 12, in <module>
                process()
              File "pkg/utils.py", line 45, in process
                compute()
              File "/data/user/0/app/calc.py", line 102, in compute
                return 1 / 0
            ZeroDivisionError: division by zero
        """.trimIndent()

        val frames = provider.parseTraceback(output)
        assertEquals(3, frames.size)
        assertEquals("main.py", frames[0].file)
        assertEquals(12, frames[0].line)
        assertEquals("<module>", frames[0].function)

        assertEquals("pkg/utils.py", frames[1].file)
        assertEquals(45, frames[1].line)
        assertEquals("process", frames[1].function)

        assertEquals("/data/user/0/app/calc.py", frames[2].file)
        assertEquals(102, frames[2].line)
        assertEquals("compute", frames[2].function)
    }

    @Test
    fun `classifyError extracts common python exceptions`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val provider = PythonLanguageProvider(workspace)

        val syntax = provider.classifyError("  File \"foo.py\", line 1\n    x = \n        ^\nSyntaxError: invalid syntax")
        assertNotNull(syntax)
        assertEquals("SyntaxError", syntax!!.kind)
        assertEquals("invalid syntax", syntax.message)

        val module = provider.classifyError("ModuleNotFoundError: No module named 'requests'")
        assertNotNull(module)
        assertEquals("ModuleNotFoundError", module!!.kind)
        assertEquals("Install with pip: pip install requests", module.actionHint)

        val fnf = provider.classifyError("FileNotFoundError: [Errno 2] No such file or directory: 'data.csv'")
        assertNotNull(fnf)
        assertEquals("FileNotFoundError", fnf!!.kind)

        val zero = provider.classifyError("ZeroDivisionError: division by zero")
        assertNotNull(zero)
        assertEquals("ZeroDivisionError", zero!!.kind)

        val unknown = provider.classifyError("Everything finished normally.")
        assertNull(unknown)
    }

    @Test
    fun `buildRunCommand fails closed with E_NO_RUNTIME when runtime missing`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val provider = PythonLanguageProvider(workspace)
        val project = temp.newFolder("project")

        try {
            provider.buildRunCommand(project, "main.py")
            fail("expected BridgeException(E_NO_RUNTIME)")
        } catch (e: BridgeException) {
            assertEquals(ErrorCode.E_NO_RUNTIME, e.errorCode)
        }
    }

    @Test
    fun `buildRunCommand succeeds when runtime python is executable`() {
        val root = temp.newFolder("files")
        val workspace = Workspace(root)
        val bin = File(workspace.usr, "bin").apply { mkdirs() }
        val fakePython = File(bin, "python3").apply {
            writeText("#!/bin/sh\nexit 0\n")
            setExecutable(true)
        }
        val provider = PythonLanguageProvider(workspace)
        val project = temp.newFolder("project")

        val plan = provider.buildRunCommand(project, "main.py")
        assertEquals(listOf(fakePython.absolutePath, "main.py"), plan.argv)
        assertEquals(project, plan.cwd)
        assertEquals("script", plan.trustAction)
        assertTrue(plan.env.containsKey("PATH"))
        assertTrue(plan.env.containsKey("PYTHONHOME"))
    }
}
