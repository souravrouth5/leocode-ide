package dev.leocode.core.language

import dev.leocode.bridge.BridgeException
import dev.leocode.bridge.ErrorCode
import dev.leocode.core.PythonProject
import dev.leocode.core.Workspace
import java.io.File

/**
 * First-class Python language provider (Task 30, D-017).
 *
 * Implements [LanguageProvider] backed by [PythonProject] and the bundled CPython
 * runtime package.
 */
class PythonLanguageProvider(
    private val workspace: Workspace,
    private val extraEnv: Map<String, String> = emptyMap()
) : LanguageProvider {

    override val id: String = "python"
    override val displayName: String = "Python"
    override val runtimeId: String = "python"
    override val extensions: List<String> = listOf("py")
    override val supportsRepl: Boolean = true
    override val trustTriggers: List<String> = listOf("script", "venv", "pip")
    override val requiresRuntime: Boolean = true

    override fun buildRunCommand(projectDir: File, fileRelPath: String): RunCommandPlan {
        val project = PythonProject(workspace, projectDir, extraEnv)
        val status = project.status()
        if (!status.runtimeInstalled && !status.venvExists) {
            throw BridgeException(
                ErrorCode.E_NO_RUNTIME,
                "Python is not installed. Install it from the Runtimes tab to run .py files."
            )
        }
        val interpreter = project.interpreter()
        return RunCommandPlan(
            argv = listOf(interpreter.absolutePath, fileRelPath),
            env = project.venvEnv(),
            cwd = projectDir,
            trustAction = "script"
        )
    }

    override fun buildReplCommand(projectDir: File): ReplCommandPlan {
        val project = PythonProject(workspace, projectDir, extraEnv)
        return ReplCommandPlan(
            argv = listOf(project.interpreter().absolutePath, "-i"),
            env = project.venvEnv()
        )
    }

    override fun childEnv(projectDir: File): Map<String, String> {
        val project = PythonProject(workspace, projectDir, extraEnv)
        return project.venvEnv()
    }

    override fun projectTemplate(): ProjectTemplate = ProjectTemplate(
        name = "Python Project",
        files = listOf(
            ProjectTemplateFile(
                path = "main.py",
                content = """
                    def main():
                        print("Hello from LeoCode Python!")

                    if __name__ == "__main__":
                        main()
                """.trimIndent() + "\n"
            ),
            ProjectTemplateFile(
                path = "requirements.txt",
                content = "# Add project dependencies here\n"
            ),
            ProjectTemplateFile(
                path = ".gitignore",
                content = "__pycache__/\n*.py[cod]\n.venv/\n"
            ),
            ProjectTemplateFile(
                path = "README.md",
                content = "# Python Project\n\nCreated with LeoCode.\n"
            )
        )
    )

    override fun parseTraceback(output: String): List<TracebackFrame> {
        val regex = Regex("""File "([^"]+)", line (\d+)(?:, in (.+))?""")
        return regex.findAll(output).map { match ->
            val file = match.groupValues[1]
            val line = match.groupValues[2].toIntOrNull() ?: 1
            val func = match.groupValues.getOrNull(3)?.trim()?.takeIf { it.isNotEmpty() }
            TracebackFrame(file = file, line = line, function = func)
        }.toList()
    }

    override fun classifyError(output: String): ErrorSummary? {
        val lines = output.trimEnd().lines()
        val lastLine = lines.lastOrNull()?.trim() ?: return null

        return when {
            lastLine.startsWith("SyntaxError:") -> {
                ErrorSummary(
                    kind = "SyntaxError",
                    message = lastLine.removePrefix("SyntaxError:").trim()
                )
            }
            lastLine.startsWith("ModuleNotFoundError:") -> {
                val module = Regex("""No module named '([^']+)'""").find(lastLine)?.groupValues?.get(1)
                ErrorSummary(
                    kind = "ModuleNotFoundError",
                    message = lastLine.removePrefix("ModuleNotFoundError:").trim(),
                    actionHint = module?.let { "Install with pip: pip install $it" }
                )
            }
            lastLine.startsWith("ImportError:") -> {
                ErrorSummary(
                    kind = "ImportError",
                    message = lastLine.removePrefix("ImportError:").trim()
                )
            }
            lastLine.startsWith("FileNotFoundError:") -> {
                ErrorSummary(
                    kind = "FileNotFoundError",
                    message = lastLine.removePrefix("FileNotFoundError:").trim()
                )
            }
            lastLine.startsWith("IndentationError:") -> {
                ErrorSummary(
                    kind = "IndentationError",
                    message = lastLine.removePrefix("IndentationError:").trim()
                )
            }
            lastLine.startsWith("NameError:") -> {
                ErrorSummary(
                    kind = "NameError",
                    message = lastLine.removePrefix("NameError:").trim()
                )
            }
            lastLine.startsWith("ZeroDivisionError:") -> {
                ErrorSummary(
                    kind = "ZeroDivisionError",
                    message = lastLine.removePrefix("ZeroDivisionError:").trim()
                )
            }
            else -> null
        }
    }
}
