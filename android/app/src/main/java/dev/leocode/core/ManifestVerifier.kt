package dev.leocode.core

import java.util.Base64
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer

/**
 * Verifies a detached Ed25519 signature over the exact manifest bytes (Task 25).
 *
 * The signature ships next to the manifest (`<id>.json.sig`, base64). The key is
 * compiled in ([RuntimeKeys]); a manifest is rejected before any download when
 * the signature is missing, malformed or made with another key.
 */
class ManifestVerifier(private val publicKey: ByteArray) {

    fun verify(payload: ByteArray, signatureBase64: String): Boolean {
        val signature = decode(signatureBase64) ?: return false
        if (signature.size != SIGNATURE_BYTES) return false
        return runCatching {
            val verifier = Ed25519Signer()
            verifier.init(false, Ed25519PublicKeyParameters(publicKey, 0))
            verifier.update(payload, 0, payload.size)
            verifier.verifySignature(signature)
        }.getOrDefault(false)
    }

    private fun decode(text: String): ByteArray? =
        runCatching {
            // Tolerate the newline that text editors and `openssl base64` add.
            Base64.getMimeDecoder().decode(text.trim())
        }.getOrNull()

    companion object {
        const val SIGNATURE_BYTES = 64
    }
}
