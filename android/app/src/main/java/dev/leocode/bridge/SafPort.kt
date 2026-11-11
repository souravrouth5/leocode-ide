package dev.leocode.bridge

import kotlinx.serialization.json.JsonObject

/**
 * Platform side of `saf.*` and `storage.*` (Task 6).
 *
 * Implemented by the Activity: pickers and permission dialogs need an Activity,
 * while the handler only needs a way to ask and to receive the result later.
 */
interface SafPort {

    /** `storage.info` payload. Kept in the platform layer because it names real paths. */
    fun storageInfo(): JsonObject

    fun requestStoragePermission(callback: (Boolean) -> Unit)

    /**
     * Show the open-document picker and read the chosen file. [onResult] receives
     * `null` when the user cancels; reading happens off the main thread.
     */
    fun openDocument(mime: String, onResult: (SafDocument?) -> Unit)

    /** Show the create-document picker and write [content] to the chosen target. */
    fun saveDocument(name: String, content: String, onResult: (String?) -> Unit)
}

/** A document read through SAF: display name, URI and UTF-8 content. */
data class SafDocument(
    val name: String,
    val uri: String,
    val content: String,
    val size: Int
)
