package dev.leocode.core.secrets

/**
 * Seals and opens small byte blobs with a device-bound key (Task 20).
 *
 * The production implementation is [AndroidSecretCipher] (Android Keystore,
 * AES-256-GCM). Tests use a fake so [FileSecretStore] can be exercised on a
 * plain JVM. Implementations must never cache plaintext and must not put secret
 * material into exception messages.
 */
interface SecretCipher {

    /** Encrypts [plaintext] and returns a self-describing blob safe to write to disk. */
    fun seal(plaintext: ByteArray): ByteArray

    /**
     * Decrypts a blob produced by [seal]. Throws [SecretUnavailableException]
     * when the device key is gone or invalidated; a malformed blob is a plain
     * [IllegalArgumentException], which callers treat as "no usable secret".
     */
    fun open(blob: ByteArray): ByteArray
}
