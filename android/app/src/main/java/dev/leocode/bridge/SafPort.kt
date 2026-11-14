package dev.leocode.bridge

import kotlinx.serialization.Serializable

/**
 * Platform side of `saf.*` and `storage.*` (Task 6).
 *
 * Implemented by the Activity: pickers and permission dialogs need an Activity,
 * while the handler only needs a way to ask and to receive the result later.
 */
interface SafPort {

    /** `storage.info` payload. Kept in the platform layer because it names real paths. */
    fun storageInfo(): StorageInfo

    fun requestStoragePermission(callback: (Boolean) -> Unit)

    /**
     * Show the open-document picker and read the chosen file. [onResult] is
     * `success(null)` when the user cancels and a failure when the read fails;
     * reading happens off the main thread.
     */
    fun openDocument(mime: String, onResult: (Result<SafDocument?>) -> Unit)

    /**
     * Show the create-document picker and write [content] to the chosen target.
     * `success(null)` is a cancel; a failed write is a failure (S-10/S-11).
     */
    fun saveDocument(name: String, content: String, onResult: (Result<String?>) -> Unit)

    /**
     * Show the folder picker and copy the chosen tree into the active workspace
     * (Task 14). `success(null)` is a cancel; [onProgress] reports running counts.
     */
    fun importTree(
        dest: String?,
        onProgress: (files: Int, bytes: Long) -> Unit,
        onResult: (Result<SafTreeResult?>) -> Unit
    ) {
        onResult(Result.failure(UnsupportedOperationException("folder import is unavailable")))
    }

    /**
     * Show the create-document picker and copy [archive] to it. `success(null)`
     * is a cancel.
     */
    fun exportArchive(
        name: String,
        archive: java.io.File,
        onProgress: (files: Int, bytes: Long) -> Unit,
        onResult: (Result<String?>) -> Unit
    ) {
        onResult(Result.failure(UnsupportedOperationException("backup export is unavailable")))
    }

    /**
     * Show the open-document picker for a `.zip` backup and hand back a local
     * temporary copy. `success(null)` is a cancel.
     */
    fun openArchive(onResult: (Result<java.io.File?>) -> Unit) {
        onResult(Result.failure(UnsupportedOperationException("backup restore is unavailable")))
    }
}

/** Result of a SAF folder copy-in. */
@Serializable
data class SafTreeResult(
    val path: String,
    val files: Int,
    val bytes: Long
)

/** A document read through SAF: display name, URI and UTF-8 content. */
@Serializable
data class SafDocument(
    val name: String,
    val uri: String,
    val content: String,
    val size: Int
)
