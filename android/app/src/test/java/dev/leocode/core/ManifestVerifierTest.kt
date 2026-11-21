package dev.leocode.core

import java.security.SecureRandom
import java.util.Base64
import org.bouncycastle.crypto.generators.Ed25519KeyPairGenerator
import org.bouncycastle.crypto.params.Ed25519KeyGenerationParameters
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ManifestVerifierTest {

    private class Pair {
        val private: Ed25519PrivateKeyParameters
        val public: Ed25519PublicKeyParameters
        val verifier: ManifestVerifier

        init {
            val generator = Ed25519KeyPairGenerator()
            generator.init(Ed25519KeyGenerationParameters(SecureRandom()))
            val pair = generator.generateKeyPair()
            private = pair.private as Ed25519PrivateKeyParameters
            public = pair.public as Ed25519PublicKeyParameters
            verifier = ManifestVerifier(public.encoded)
        }

        fun sign(payload: ByteArray): String {
            val signer = Ed25519Signer()
            signer.init(true, private)
            signer.update(payload, 0, payload.size)
            return Base64.getEncoder().encodeToString(signer.generateSignature())
        }
    }

    @Test
    fun `accepts a signature made with the matching key`() {
        val pair = Pair()
        val payload = """{"id":"python","version":"1"}""".toByteArray()

        assertTrue(pair.verifier.verify(payload, pair.sign(payload)))
    }

    @Test
    fun `rejects a modified manifest`() {
        val pair = Pair()
        val payload = """{"id":"python","version":"1"}""".toByteArray()
        val signature = pair.sign(payload)

        assertFalse(pair.verifier.verify("""{"id":"python","version":"2"}""".toByteArray(), signature))
    }

    @Test
    fun `rejects a signature from another key`() {
        val signer = Pair()
        val verifier = Pair().verifier
        val payload = "manifest".toByteArray()

        assertFalse(verifier.verify(payload, signer.sign(payload)))
    }

    @Test
    fun `rejects malformed signatures`() {
        val pair = Pair()
        val payload = "manifest".toByteArray()

        assertFalse(pair.verifier.verify(payload, ""))
        assertFalse(pair.verifier.verify(payload, "not base64"))
        assertFalse(pair.verifier.verify(payload, Base64.getEncoder().encodeToString(ByteArray(10))))
    }

    @Test
    fun `the committed python key is a valid Ed25519 key`() {
        // 32 raw bytes is the only length Bouncy Castle accepts for Ed25519.
        assertTrue(RuntimeKeys.PYTHON.size == 32)
        assertTrue(RuntimeKeys.FINGERPRINT.matches(Regex("^[a-f0-9]{64}$")))
    }
}
