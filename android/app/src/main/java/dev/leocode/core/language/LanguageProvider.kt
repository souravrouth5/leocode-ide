package dev.leocode.core.language

import dev.leocode.bridge.LanguageDescriptor
import java.io.File

/** Command and environment planned for executing a script/module (Task 30). */
data class RunCommandPlan(
    val argv: List<String>,
    val env: Map<String, String> = emptyMap(),
    val cwd: File? = null,
    val trustAction: String? = "script"
)

/** Command and environment planned for interactive REPL (Tasks 30, 32). */
data class ReplCommandPlan(
    val argv: List<String>,
    val env: Map<String, String> = emptyMap()
)

data class ProjectTemplateFile(
    val path: String,
    val content: String
)

data class ProjectTemplate(
    val name: String,
    val files: List<ProjectTemplateFile>
)

data class TracebackFrame(
    val file: String,
    val line: Int,
    val function: String? = null
)

data class ErrorSummary(
    val kind: String,
    val message: String,
    val actionHint: String? = null
)

/**
 * Pluggable language provider interface (Task 30, D-017).
 *
 * Defines language identification, runtime linkage, command generation,
 * templates, and error classification without hard-coding language specifics into
 * the IDE shell.
 */
interface LanguageProvider {
    val id: String
    val displayName: String
    val runtimeId: String?
    val extensions: List<String>
    val supportsRepl: Boolean
    val trustTriggers: List<String>
    val requiresRuntime: Boolean

    fun descriptor(): LanguageDescriptor = LanguageDescriptor(
        id = id,
        displayName = displayName,
        extensions = extensions,
        runtimeId = runtimeId,
        supportsRepl = supportsRepl,
        trustTriggers = trustTriggers,
        templateFiles = projectTemplate()?.files?.map { it.path } ?: emptyList(),
        requiresRuntime = requiresRuntime
    )

    fun buildRunCommand(projectDir: File, fileRelPath: String): RunCommandPlan
    fun buildReplCommand(projectDir: File): ReplCommandPlan? = null
    fun childEnv(projectDir: File): Map<String, String> = emptyMap()
    fun projectTemplate(): ProjectTemplate? = null
    fun parseTraceback(output: String): List<TracebackFrame> = emptyList()
    fun classifyError(output: String): ErrorSummary? = null
}
