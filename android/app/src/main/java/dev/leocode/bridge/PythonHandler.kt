package dev.leocode.bridge

import dev.leocode.core.PathJail
import dev.leocode.core.PythonProject
import dev.leocode.core.PythonProjectException
import dev.leocode.core.PythonStatus
import dev.leocode.core.TrustAction
import dev.leocode.core.TrustFingerprint
import dev.leocode.core.TrustStore
import dev.leocode.core.Workspace
import java.io.File
import java.util.UUID
import java.util.concurrent.Executors
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/**
 * `python.*` (Task 26): the per-project venv, `requirements.txt`, and the
 * interpreter used by Run.
 *
 * Creating a venv or installing requirements is slow enough to outlive the
 * bridge's reply-on-start window, so both answer after the work finishes and
 * stream `python.install` lines in the meantime. Trust is enforced here as well
 * as in the UI: a grant for this project and the current fingerprint is
 * required before either action runs.
 */
class PythonHandler(
    private val workspace: Workspace,
    private val jail: PathJail,
    private val activeRoot: () -> File,
    private val trust: TrustStore,
    private val json: Json = BridgeJson.value,
    private val log: (String) -> Unit = {}
) : AsyncBridgeHandler {

    companion object {
        val METHODS = setOf(
            "python.status",
            "python.venv.create",
            "python.venv.remove",
            "python.requirements.install"
        )

        private fun correlationId(): String =
            "c-" + UUID.randomUUID().toString().replace("-", "").take(6)
    }

    private val io = Executors.newCachedThreadPool { runnable ->
        Thread(runnable, "leocode-python").apply { isDaemon = true }
    }

    override fun methods(): Set<String> = METHODS

    override fun handle(
        method: String,
        payload: JsonObject,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        when (method) {
            "python.status" -> {
                val project = projectOf(
                    json.decodePayload(PythonProjectRequest.serializer(), payload, method).project
                )
                respond(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            PythonStatusReply.serializer(),
                            reply(PythonProject(workspace, project).status())
                        )
                    )
                )
            }

            "python.venv.create" -> {
                val project = projectOf(
                    json.decodePayload(PythonProjectRequest.serializer(), payload, method).project
                )
                createVenv(project, respond)
            }

            "python.venv.remove" -> {
                val project = projectOf(
                    json.decodePayload(PythonProjectRequest.serializer(), payload, method).project
                )
                removeVenv(project, respond)
            }

            "python.requirements.install" -> {
                val project = projectOf(
                    json.decodePayload(PythonProjectRequest.serializer(), payload, method).project
                )
                installRequirements(project, respond, sink)
            }

            else -> throw BridgeException(ErrorCode.E_UNKNOWN_METHOD, "unknown method: $method")
        }
    }

    private fun createVenv(project: File, respond: (AsyncReply) -> Unit) {
        val projectPath = project.canonicalPath
        val fingerprint = try {
            TrustFingerprint.compute(project, TrustAction.VENV, extra = runtimeMarker())
        } catch (e: Exception) {
            respond(
                AsyncReply.Error(
                    ErrorCode.E_IO,
                    "cannot fingerprint the project files",
                    correlationId()
                )
            )
            return
        }
        if (!trust.check(projectPath, TrustAction.VENV, fingerprint)) {
            respond(
                AsyncReply.Error(
                    ErrorCode.E_PERMISSION,
                    "trust this project before creating its Python environment"
                )
            )
            return
        }

        io.execute {
            val python = PythonProject(workspace, project)
            val existed = python.venvPython.isFile
            try {
                val status = python.createVenv()
                respond(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            PythonVenvReply.serializer(),
                            PythonVenvReply(created = !existed, status = reply(status))
                        )
                    )
                )
            } catch (e: PythonProjectException) {
                fail("python.venv.create", e, respond)
            } catch (e: Throwable) {
                fail("python.venv.create", e, respond)
            }
        }
    }

    private fun removeVenv(project: File, respond: (AsyncReply) -> Unit) {
        io.execute {
            val python = PythonProject(workspace, project)
            try {
                python.removeVenv()
                respond(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            PythonStatusReply.serializer(),
                            reply(python.status())
                        )
                    )
                )
            } catch (e: PythonProjectException) {
                fail("python.venv.remove", e, respond)
            } catch (e: Throwable) {
                fail("python.venv.remove", e, respond)
            }
        }
    }

    private fun installRequirements(
        project: File,
        respond: (AsyncReply) -> Unit,
        sink: StreamSink
    ) {
        val projectPath = project.canonicalPath
        val python = PythonProject(workspace, project)
        val fingerprint = try {
            TrustFingerprint.compute(project, TrustAction.PIP)
        } catch (e: Exception) {
            respond(
                AsyncReply.Error(
                    ErrorCode.E_IO,
                    "cannot fingerprint requirements.txt",
                    correlationId()
                )
            )
            return
        }
        if (!trust.check(projectPath, TrustAction.PIP, fingerprint)) {
            respond(
                AsyncReply.Error(
                    ErrorCode.E_PERMISSION,
                    "trust this project before installing its requirements"
                )
            )
            return
        }
        if (!python.requirements.isFile) {
            respond(AsyncReply.Error(ErrorCode.E_NOT_FOUND, "this project has no requirements.txt"))
            return
        }
        if (!python.venvPython.isFile) {
            respond(
                AsyncReply.Error(
                    ErrorCode.E_NOT_FOUND,
                    "create the Python environment before installing requirements"
                )
            )
            return
        }

        io.execute {
            try {
                val result = python.runRequirements { line ->
                    sink.event(
                        "python.install",
                        json.encodeToJsonElement(
                            PythonInstallEvent.serializer(),
                            PythonInstallEvent(line)
                        )
                    )
                }
                respond(
                    AsyncReply.Ok(
                        json.encodeToJsonElement(
                            PythonRequirementsReply.serializer(),
                            PythonRequirementsReply(
                                ok = result.exit == 0,
                                exitCode = result.exit,
                                output = result.output.takeLast(4_000)
                            )
                        )
                    )
                )
            } catch (e: PythonProjectException) {
                fail("python.requirements.install", e, respond)
            } catch (e: Throwable) {
                fail("python.requirements.install", e, respond)
            }
        }
    }

    private fun fail(method: String, error: Throwable, respond: (AsyncReply) -> Unit) {
        val id = correlationId()
        val code = (error as? PythonProjectException)?.code
        log("$method $id ${error.javaClass.simpleName}: ${error.message ?: ""}")
        respond(
            if (code != null) {
                AsyncReply.Error(
                    ErrorCode.fromCode(code),
                    error.message ?: "the Python command failed",
                    id
                )
            } else {
                AsyncReply.Error(ErrorCode.E_INTERNAL, "the Python command failed", id)
            }
        )
    }

    private fun projectOf(raw: String?): File = try {
        val base = activeRoot()
        if (raw.isNullOrBlank()) {
            base.canonicalFile
        } else if (File(raw).isAbsolute) {
            jail.resolve(raw, base)
        } else {
            workspace.jail(base, raw)
        }
    } catch (e: SecurityException) {
        throw BridgeException(ErrorCode.E_PATH_OUTSIDE_ROOT, "project is outside the allowed roots")
    }

    private fun runtimeMarker(): String =
        File(workspace.usr, ".leocode-runtime.json").takeIf { it.isFile }
            ?.readText().orEmpty()

    private fun reply(status: PythonStatus) =
        PythonStatusReply(
            runtimeInstalled = status.runtimeInstalled,
            runtimePython = status.runtimePython,
            venvExists = status.venvExists,
            venvPath = status.venvPath,
            venvPython = status.venvPython,
            requirementsExists = status.requirementsExists,
            requirementsPath = status.requirementsPath,
            requirementsHash = status.requirementsHash,
            requirementsInstalled = status.requirementsInstalled,
            aliasesReady = status.aliasesReady
        )
}
