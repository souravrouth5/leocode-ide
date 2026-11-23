package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.language.LanguageRegistry
import java.io.File
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

/**
 * `language.*` (Task 30): Language capabilities and execution planning.
 *
 * Exposes registered languages to the web IDE and constructs command/environment
 * plans without hardcoding language behaviors in the bridge caller.
 */
class LanguageHandler(
    private val registry: LanguageRegistry,
    private val activeRoot: () -> File,
    private val jail: PathJail,
    private val json: Json = BridgeJson.value
) : BridgeHandler {

    companion object {
        val METHODS = setOf("language.list", "language.plan")
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(method: String, payload: JsonObject): JsonObject = when (method) {
        "language.list" -> {
            val reply = LanguageListReply(languages = registry.all().map { it.descriptor() })
            json.encodeToJsonElement(LanguageListReply.serializer(), reply) as JsonObject
        }
        "language.plan" -> {
            val req = json.decodeFromJsonElement(LanguagePlanRequest.serializer(), payload)
            val projectDir = if (req.project != null) {
                jail.resolve(req.project)
            } else {
                activeRoot()
            }
            val provider = registry.findForFile(req.file)
                ?: throw BridgeException(
                    ErrorCode.E_UNSUPPORTED,
                    "No language provider registered for file: ${req.file}"
                )
            val plan = provider.buildRunCommand(projectDir, req.file)
            val reply = LanguagePlanReply(
                languageId = provider.id,
                argv = plan.argv,
                env = plan.env,
                cwd = plan.cwd?.absolutePath,
                trustAction = plan.trustAction
            )
            json.encodeToJsonElement(LanguagePlanReply.serializer(), reply) as JsonObject
        }
        else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown language method $method")
    }
}
