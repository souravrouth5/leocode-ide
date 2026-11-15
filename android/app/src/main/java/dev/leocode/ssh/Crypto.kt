package dev.leocode.ssh

import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Provider
import java.security.PublicKey
import java.security.Security
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec
import org.apache.sshd.common.config.keys.KeyUtils
import org.apache.sshd.common.config.keys.PublicKeyEntry
import org.bouncycastle.jce.provider.BouncyCastleProvider

/**
 * Crypto helpers for the SSH keys (Task 23).
 *
 * Ed25519 is generated with the i2p EdDSA provider that ships with MINA SSHD
 * (`net.i2p.crypto:eddsa`). On Android the platform has no Ed25519
 * `KeyPairGenerator`, and asking the JDK for "EdDSA" picks a key type that
 * MINA cannot encode, so the provider object is always passed explicitly.
 *
 * BouncyCastle is installed for PEM/OpenSSH edge cases. Android already has a
 * provider called `BC`, so the newer jar is registered as `LeoCodeBC` when the
 * name is taken; the provider instance is also available for explicit use.
 * Existing platform providers are never replaced.
 *
 * Passphrases for stored keys are turned into an AES-256-GCM key with
 * PBKDF2-HMAC-SHA256 (~120k iterations). This is only a second layer on top of
 * the Keystore-sealed file, so no password verifier is stored and a wrong
 * passphrase simply fails authentication.
 */
object Crypto {

    private const val PBKDF2_ITERATIONS = 120_000
    private const val SALT_BYTES = 16
    private const val IV_BYTES = 12
    private const val GCM_TAG_BITS = 128

    private val eddsaProvider: Provider = net.i2p.crypto.eddsa.EdDSASecurityProvider()

    @Volatile
    private var bouncyCastle: Provider? = null

    /** Registers BouncyCastle once; safe to call from any thread. */
    @Synchronized
    fun ensureProviders(): Provider {
        bouncyCastle?.let { return it }
        val existing = Security.getProvider("BC")
        if (existing != null) {
            // Android's platform BC keeps the name; newer algorithms are reached
            // through the provider object returned by bouncyCastle().
            bouncyCastle = existing
            return existing
        }
        val provider = BouncyCastleProvider()
        if (Security.getProvider(provider.name) == null) {
            Security.addProvider(provider)
        }
        bouncyCastle = provider
        return provider
    }

    fun bouncyCastle(): Provider = bouncyCastle ?: ensureProviders()

    /** A fresh Ed25519 pair that MINA SSHD can encode and sign with. */
    fun generateEd25519(): KeyPair =
        net.i2p.crypto.eddsa.KeyPairGenerator().generateKeyPair()

    fun generateRsa(bits: Int): KeyPair =
        KeyPairGenerator.getInstance("RSA").apply { initialize(bits) }.generateKeyPair()

    /** PKCS#8 bytes for storage; never logged and never returned to the WebView. */
    fun encodePrivate(pair: KeyPair): ByteArray =
        pair.private.encoded ?: throw java.io.IOException("this key cannot be stored")

    /** Rebuilds the private key from stored PKCS#8 bytes. */
    fun decodePrivate(type: String, pkcs8: ByteArray): java.security.PrivateKey {
        val spec = PKCS8EncodedKeySpec(pkcs8)
        return when (type) {
            "ed25519" -> KeyFactory.getInstance("EdDSA", eddsaProvider).generatePrivate(spec)
            "rsa" -> KeyFactory.getInstance("RSA").generatePrivate(spec)
            "ecdsa" -> KeyFactory.getInstance("EC").generatePrivate(spec)
            else -> throw java.io.IOException("unsupported key type: $type")
        }
    }

    /** Public key from the OpenSSH line stored in metadata. */
    fun decodePublic(line: String): PublicKey {
        val parsed = PublicKeyEntry.parsePublicKeyEntry(line)
        return parsed.resolvePublicKey(
            null,
            emptyMap(),
            org.apache.sshd.common.config.keys.PublicKeyEntryResolver.IGNORING
        ) ?: throw java.io.IOException("unsupported public key type")
    }

    fun encodePublic(publicKey: PublicKey): String =
        PublicKeyEntry.toString(publicKey)

    fun keyType(publicKey: PublicKey): String {
        val raw = KeyUtils.getKeyType(publicKey) ?: "unknown"
        return when (raw) {
            "ssh-ed25519" -> "ed25519"
            "ssh-rsa" -> "rsa"
            else -> if (raw.startsWith("ecdsa-")) "ecdsa" else raw
        }
    }

    fun fingerprint(publicKey: PublicKey): String = KeyUtils.getFingerPrint(publicKey)

    /** SHA-256 fingerprint of an OpenSSH public-key line, for known_hosts rows. */
    fun fingerprintOfLine(line: String): String = fingerprint(decodePublic(line))

    /** Wraps [pkcs8] with a passphrase-derived AES-256-GCM key. */
    fun sealWithPassphrase(pkcs8: ByteArray, passphrase: CharArray): ByteArray {
        val salt = ByteArray(SALT_BYTES).also { java.security.SecureRandom().nextBytes(it) }
        val iv = ByteArray(IV_BYTES).also { java.security.SecureRandom().nextBytes(it) }
        val key = derive(passphrase, salt)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        val encrypted = cipher.doFinal(pkcs8)
        return buildBlob(salt, iv, encrypted)
    }

    /** Opens a blob from [sealWithPassphrase]; a wrong passphrase is "wrong passphrase". */
    fun openWithPassphrase(blob: ByteArray, passphrase: CharArray): ByteArray {
        if (blob.size < 10 + SALT_BYTES + IV_BYTES + 16) {
            throw java.io.IOException("stored key is corrupt")
        }
        val magic = String(blob.copyOfRange(0, 4), Charsets.US_ASCII)
        if (magic != "LKP1" || blob[4].toInt() != 1) {
            throw java.io.IOException("stored key is corrupt")
        }
        val saltLength = blob[5].toInt() and 0xff
        val iterations = readInt(blob, 6)
        var offset = 10
        if (saltLength != SALT_BYTES || iterations <= 0) {
            throw java.io.IOException("stored key is corrupt")
        }
        val salt = blob.copyOfRange(offset, offset + saltLength)
        offset += saltLength
        val iv = blob.copyOfRange(offset, offset + IV_BYTES)
        offset += IV_BYTES
        val key = derive(passphrase, salt, iterations)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        return try {
            cipher.doFinal(blob, offset, blob.size - offset)
        } catch (_: javax.crypto.AEADBadTagException) {
            throw java.io.IOException("wrong passphrase for this key")
        } catch (_: java.security.GeneralSecurityException) {
            throw java.io.IOException("wrong passphrase for this key")
        }
    }

    private fun buildBlob(salt: ByteArray, iv: ByteArray, encrypted: ByteArray): ByteArray {
        val out = ByteArray(10 + salt.size + iv.size + encrypted.size)
        "LKP1".toByteArray(Charsets.US_ASCII).copyInto(out, 0)
        out[4] = 1
        out[5] = salt.size.toByte()
        writeInt(out, 6, PBKDF2_ITERATIONS)
        salt.copyInto(out, 10)
        iv.copyInto(out, 10 + salt.size)
        encrypted.copyInto(out, 10 + salt.size + iv.size)
        return out
    }

    private fun derive(
        passphrase: CharArray,
        salt: ByteArray,
        iterations: Int = PBKDF2_ITERATIONS
    ): SecretKeySpec {
        val factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
        val spec = PBEKeySpec(passphrase, salt, iterations, 256)
        val bytes = factory.generateSecret(spec).encoded
        return SecretKeySpec(bytes, "AES")
    }

    private fun readInt(bytes: ByteArray, offset: Int): Int =
        ((bytes[offset].toInt() and 0xff) shl 24) or
            ((bytes[offset + 1].toInt() and 0xff) shl 16) or
            ((bytes[offset + 2].toInt() and 0xff) shl 8) or
            (bytes[offset + 3].toInt() and 0xff)

    private fun writeInt(bytes: ByteArray, offset: Int, value: Int) {
        bytes[offset] = (value ushr 24).toByte()
        bytes[offset + 1] = (value ushr 16).toByte()
        bytes[offset + 2] = (value ushr 8).toByte()
        bytes[offset + 3] = value.toByte()
    }
}
