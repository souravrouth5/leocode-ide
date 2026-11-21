package dev.leocode.bridge

import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.descriptors.SerialKind
import kotlinx.serialization.descriptors.StructureKind
import kotlinx.serialization.descriptors.elementDescriptors

/**
 * Writes `web/src/bridge/types.gen.ts` from the serial descriptors of the
 * [Contract] DTOs (Task 7). Pure JVM: the Gradle `generateBridgeTypes` task runs
 * it against the app's unit-test classpath.
 */
@OptIn(ExperimentalSerializationApi::class)
object BridgeTypesGenerator {

    private val seeds: List<Pair<String, SerialDescriptor>> = listOf(
        "BridgeReply" to BridgeReply.serializer().descriptor,
        "BridgeEvent" to BridgeEvent.serializer().descriptor,
        "BridgeErrorBody" to BridgeErrorBody.serializer().descriptor,
        "PingReply" to PingReply.serializer().descriptor,
        "ThemeState" to ThemeState.serializer().descriptor,
        "ThemeSetRequest" to ThemeSetRequest.serializer().descriptor,
        "AppInfo" to AppInfo.serializer().descriptor,
        "FileEntry" to FileEntry.serializer().descriptor,
        "PathRequest" to PathRequest.serializer().descriptor,
        "PathReply" to PathReply.serializer().descriptor,
        "ReadReply" to ReadReply.serializer().descriptor,
        "ReadRequest" to ReadRequest.serializer().descriptor,
        "WriteRequest" to WriteRequest.serializer().descriptor,
        "WriteReply" to WriteReply.serializer().descriptor,
        "StatRequest" to StatRequest.serializer().descriptor,
        "StatReply" to StatReply.serializer().descriptor,
        "RenameRequest" to RenameRequest.serializer().descriptor,
        "RenameReply" to RenameReply.serializer().descriptor,
        "DeleteReply" to DeleteReply.serializer().descriptor,
        "WorkspaceInfo" to WorkspaceInfo.serializer().descriptor,
        "WorkspaceCreateRequest" to WorkspaceCreateRequest.serializer().descriptor,
        "WorkspaceIdRequest" to WorkspaceIdRequest.serializer().descriptor,
        "WorkspaceRenameRequest" to WorkspaceRenameRequest.serializer().descriptor,
        "WorkspaceReply" to WorkspaceReply.serializer().descriptor,
        "WorkspaceListReply" to WorkspaceListReply.serializer().descriptor,
        "WorkspaceOk" to WorkspaceOk.serializer().descriptor,
        "DraftInfo" to DraftInfo.serializer().descriptor,
        "DraftRequest" to DraftRequest.serializer().descriptor,
        "DraftSaveRequest" to DraftSaveRequest.serializer().descriptor,
        "DraftReadReply" to DraftReadReply.serializer().descriptor,
        "SearchRequest" to SearchRequest.serializer().descriptor,
        "SearchMatch" to SearchMatch.serializer().descriptor,
        "SearchDone" to SearchDone.serializer().descriptor,
        "SearchCancelRequest" to SearchCancelRequest.serializer().descriptor,
        "SearchCancelReply" to SearchCancelReply.serializer().descriptor,
        "ProcRunRequest" to ProcRunRequest.serializer().descriptor,
        "ProcRunReply" to ProcRunReply.serializer().descriptor,
        "ProcCancelRequest" to ProcCancelRequest.serializer().descriptor,
        "ProcCancelReply" to ProcCancelReply.serializer().descriptor,
        "ProcOutput" to ProcOutput.serializer().descriptor,
        "ProcExit" to ProcExit.serializer().descriptor,
        "TermOpenRequest" to TermOpenRequest.serializer().descriptor,
        "TermOpenReply" to TermOpenReply.serializer().descriptor,
        "TermWriteRequest" to TermWriteRequest.serializer().descriptor,
        "TermWriteReply" to TermWriteReply.serializer().descriptor,
        "TermResizeRequest" to TermResizeRequest.serializer().descriptor,
        "TermOk" to TermOk.serializer().descriptor,
        "TermAckRequest" to TermAckRequest.serializer().descriptor,
        "TermSessionRequest" to TermSessionRequest.serializer().descriptor,
        "TermCloseReply" to TermCloseReply.serializer().descriptor,
        "TermAttachReply" to TermAttachReply.serializer().descriptor,
        "TermInfo" to TermInfo.serializer().descriptor,
        "TermData" to TermData.serializer().descriptor,
        "TermExit" to TermExit.serializer().descriptor,
        "SafOpenRequest" to SafOpenRequest.serializer().descriptor,
        "SafOpenReply" to SafOpenReply.serializer().descriptor,
        "SafSaveRequest" to SafSaveRequest.serializer().descriptor,
        "SafSaveReply" to SafSaveReply.serializer().descriptor,
        "SafImportRequest" to SafImportRequest.serializer().descriptor,
        "SafImportReply" to SafImportReply.serializer().descriptor,
        "SafExportRequest" to SafExportRequest.serializer().descriptor,
        "SafExportReply" to SafExportReply.serializer().descriptor,
        "SafRestoreRequest" to SafRestoreRequest.serializer().descriptor,
        "SafRestoreReply" to SafRestoreReply.serializer().descriptor,
        "SafProgress" to SafProgress.serializer().descriptor,
        "StorageInfo" to StorageInfo.serializer().descriptor,
        "StoragePermissionReply" to StoragePermissionReply.serializer().descriptor,
        "RuntimeInstallRequest" to RuntimeInstallRequest.serializer().descriptor,
        "RuntimeInstallReply" to RuntimeInstallReply.serializer().descriptor,
        "RuntimeProgress" to RuntimeProgress.serializer().descriptor,
        "RuntimeResult" to RuntimeResult.serializer().descriptor,
        "RuntimeCatalogEntry" to RuntimeCatalogEntry.serializer().descriptor,
        "RuntimeCancelRequest" to RuntimeCancelRequest.serializer().descriptor,
        "RuntimeCancelReply" to RuntimeCancelReply.serializer().descriptor,
        "SafDocument" to SafDocument.serializer().descriptor,
        "SecretSetRequest" to SecretSetRequest.serializer().descriptor,
        "SecretHostsReply" to SecretHostsReply.serializer().descriptor,
        "GitRepoRequest" to GitRepoRequest.serializer().descriptor,
        "GitFileChange" to GitFileChange.serializer().descriptor,
        "GitStatusReply" to GitStatusReply.serializer().descriptor,
        "GitInitRequest" to GitInitRequest.serializer().descriptor,
        "GitPathsRequest" to GitPathsRequest.serializer().descriptor,
        "GitCommitRequest" to GitCommitRequest.serializer().descriptor,
        "GitCommitReply" to GitCommitReply.serializer().descriptor,
        "GitDiffRequest" to GitDiffRequest.serializer().descriptor,
        "GitDiffReply" to GitDiffReply.serializer().descriptor,
        "GitLogRequest" to GitLogRequest.serializer().descriptor,
        "GitCommitInfo" to GitCommitInfo.serializer().descriptor,
        "GitLogReply" to GitLogReply.serializer().descriptor,
        "GitBranchInfo" to GitBranchInfo.serializer().descriptor,
        "GitBranchListReply" to GitBranchListReply.serializer().descriptor,
        "GitBranchRequest" to GitBranchRequest.serializer().descriptor,
        "GitCheckoutRequest" to GitCheckoutRequest.serializer().descriptor,
        "GitAuth" to GitAuth.serializer().descriptor,
        "GitRemoteInfo" to GitRemoteInfo.serializer().descriptor,
        "GitRemoteListReply" to GitRemoteListReply.serializer().descriptor,
        "GitRemoteSetRequest" to GitRemoteSetRequest.serializer().descriptor,
        "GitCloneRequest" to GitCloneRequest.serializer().descriptor,
        "GitSyncRequest" to GitSyncRequest.serializer().descriptor,
        "GitSyncReply" to GitSyncReply.serializer().descriptor,
        "GitCancelRequest" to GitCancelRequest.serializer().descriptor,
        "GitCancelReply" to GitCancelReply.serializer().descriptor,
        "GitConflictRequest" to GitConflictRequest.serializer().descriptor,
        "GitConflictReply" to GitConflictReply.serializer().descriptor,
        "GitResolveRequest" to GitResolveRequest.serializer().descriptor,
        "GitProgress" to GitProgress.serializer().descriptor,
        "SshKeyInfo" to SshKeyInfo.serializer().descriptor,
        "SshKeyListReply" to SshKeyListReply.serializer().descriptor,
        "SshKeyGenerateRequest" to SshKeyGenerateRequest.serializer().descriptor,
        "SshKeyImportRequest" to SshKeyImportRequest.serializer().descriptor,
        "SshKeyIdRequest" to SshKeyIdRequest.serializer().descriptor,
        "SshHostAnswerRequest" to SshHostAnswerRequest.serializer().descriptor,
        "SshKnownHostInfo" to SshKnownHostInfo.serializer().descriptor,
        "SshKnownHostListReply" to SshKnownHostListReply.serializer().descriptor,
        "SshKnownHostDeleteRequest" to SshKnownHostDeleteRequest.serializer().descriptor,
        "SshHostPrompt" to SshHostPrompt.serializer().descriptor,
        "GitOk" to GitOk.serializer().descriptor
    )

    fun generate(): String {
        val queue = ArrayDeque(seeds)
        val emitted = LinkedHashMap<String, SerialDescriptor>()
        while (queue.isNotEmpty()) {
            val (name, descriptor) = queue.removeFirst()
            if (emitted.containsKey(name)) continue
            emitted[name] = descriptor
            for (element in descriptor.elementDescriptors) {
                nestedClass(element)?.let { queue.addLast(it) }
            }
        }

        return buildString {
            appendLine("// AUTO-GENERATED by ./gradlew generateBridgeTypes — do not edit.")
            appendLine("// Source: android/app/src/main/java/dev/leocode/bridge/Contract.kt")
            appendLine()
            appendLine("export const ERROR_CODES = [")
            for (code in ErrorCode.entries) {
                appendLine("  \"${code.code}\",")
            }
            appendLine("] as const")
            appendLine()
            appendLine("export type ErrorCode = (typeof ERROR_CODES)[number]")
            appendLine()
            appendLine("export function isErrorCode(value: unknown): value is ErrorCode {")
            appendLine("  return typeof value === \"string\" && (ERROR_CODES as readonly string[]).includes(value)")
            appendLine("}")
            appendLine()
            for ((name, descriptor) in emitted) {
                appendLine()
                emitInterface(this, name, descriptor)
            }
        }
    }

    private fun emitInterface(out: StringBuilder, name: String, descriptor: SerialDescriptor) {
        out.appendLine("export interface $name {")
        for (index in 0 until descriptor.elementsCount) {
            val element = descriptor.getElementDescriptor(index)
            val optional = descriptor.isElementOptional(index)
            val propertyName = descriptor.getElementName(index)
            out.append("  $propertyName")
            if (optional) out.append("?")
            out.append(": ")
            out.append(typeOf(element))
            out.appendLine()
        }
        out.appendLine("}")
    }

    private fun typeOf(descriptor: SerialDescriptor): String {
        val base = when {
            descriptor.kind == StructureKind.LIST -> {
                val element = typeOf(descriptor.getElementDescriptor(0))
                if (element.contains(" | ")) "($element)[]" else "$element[]"
            }

            descriptor.kind == StructureKind.MAP -> {
                "Record<string, ${typeOf(descriptor.getElementDescriptor(1))}>"
            }

            descriptor.kind is PrimitiveKind -> primitive(descriptor.kind as PrimitiveKind)
            descriptor.kind == SerialKind.ENUM -> enumName(descriptor)
            descriptor.serialName.startsWith("kotlinx.") -> "unknown"
            descriptor.kind == StructureKind.CLASS ||
                descriptor.kind == StructureKind.OBJECT -> simpleName(descriptor)
            else -> "unknown"
        }
        return if (descriptor.isNullable) "$base | null" else base
    }

    private fun nestedClass(descriptor: SerialDescriptor): Pair<String, SerialDescriptor>? {
        if (descriptor.serialName.startsWith("kotlinx.")) return null
        return when (descriptor.kind) {
            StructureKind.CLASS, StructureKind.OBJECT ->
                simpleName(descriptor) to descriptor
            StructureKind.LIST -> nestedClass(descriptor.getElementDescriptor(0))
            StructureKind.MAP -> nestedClass(descriptor.getElementDescriptor(1))
            else -> null
        }
    }

    private fun enumName(descriptor: SerialDescriptor): String = simpleName(descriptor)

    /** Nullable descriptors append `?` to the serial name; TS adds its own `| null`. */
    private fun simpleName(descriptor: SerialDescriptor): String =
        descriptor.serialName.substringAfterLast('.').removeSuffix("?")

    private fun primitive(kind: PrimitiveKind): String = when (kind) {
        PrimitiveKind.BOOLEAN -> "boolean"
        PrimitiveKind.STRING -> "string"
        PrimitiveKind.CHAR -> "string"
        else -> "number"
    }
}
