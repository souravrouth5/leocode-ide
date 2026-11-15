package dev.leocode.core.secrets

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.KeyStore
import java.security.ProviderException
import java.security.SecureRandom
import java.security.UnrecoverableKeyException
import javax.crypto.AEADBadTagException
import javax.crypto.BadPaddingException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Device-bound AES-256-GCM cipher backed by one Android Keystore key (Task 20).
 *
 * The key alias is fixed (`leocode.secretstore.v1`) and the key never leaves the
 * Keystore. StrongBox is requested when the device advertises it; any failure
 * falls back to the TEE-backed key, and the chosen mode is logged once as
 * `LeoCodeSecrets: strongBox=<boolean>` for the T14 evidence row.
 *
 * Blob layout: `LCS1 | version(1) | ivLen(1) | iv | ciphertext+tag`. The header
 * lets a future version change the cipher without guessing from the file size,
 * and makes a truncated/foreign file fail as corrupt rather than as a key error.
 *
 * Key invalidation (lock-screen change, Keystore reset, factory reset without
 * restore) becomes [SecretUnavailableException]; a damaged blob is an
 * [IllegalArgumentException] that [FileSecretStore] turns into "no secret".
 */
class AndroidSecretCipher(
    private val keyStore: KeyStore = openKeyStore(),
    private val log: (String) -> Unit = { line -> android.util.Log.i(TAG, line) }
) : SecretCipher {

    companion object {
        const val TAG = "LeoCodeSecrets"
        const val KEY_ALIAS = "leocode.secretstore.v1"

        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_BYTES = 12
        private const val GCM_TAG_BITS = 128
        private const val VERSION = 1
        private val MAGIC = byteArrayOf('L'.code.toByte(), 'C'.code.toByte(), 'S'.code.toByte(), '1'.code.toByte())
        private const val HEADER_BYTES = 6 // magic(4) + version(1) + ivLen(1)
        private const val TAG_BYTES = GCM_TAG_BITS / 8

        private fun openKeyStore(): KeyStore =
            KeyStore.getInstance(KEYSTORE).apply { load(null) }
    }

    private val key: SecretKey

    init {
        val loaded = loadOrCreateKey()
        key = loaded.first
        // Exactly one line per creation; T14 greps this from logcat.
        log("strongBox=${loaded.second}")
    }

    override fun seal(plaintext: ByteArray): ByteArray {
        return try {
            // The key is created with setRandomizedEncryptionRequired(true), so
            // Keystore2 refuses a caller-supplied IV (CALLER_NONCE_PROHIBITED).
            // Initialise without one and read back the IV it chose; it is
            // stored in the header so open() can use it.
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val iv = cipher.iv
            val ciphertext = cipher.doFinal(plaintext)
            val out = ByteArray(HEADER_BYTES + iv.size + ciphertext.size)
            MAGIC.copyInto(out, 0)
            out[4] = VERSION.toByte()
            out[5] = iv.size.toByte()
            iv.copyInto(out, HEADER_BYTES)
            ciphertext.copyInto(out, HEADER_BYTES + iv.size)
            out
        } catch (e: GeneralSecurityException) {
            throw SecretUnavailableException()
        }
    }

    override fun open(blob: ByteArray): ByteArray {
        if (blob.size < HEADER_BYTES + 1 + TAG_BYTES) {
            throw IllegalArgumentException("secret blob is truncated")
        }
        for (index in MAGIC.indices) {
            if (blob[index] != MAGIC[index]) {
                throw IllegalArgumentException("not a LeoCode secret blob")
            }
        }
        if (blob[4].toInt() != VERSION) {
            throw IllegalArgumentException("unsupported secret blob version")
        }
        val ivLength = blob[5].toInt() and 0xff
        if (ivLength <= 0 || ivLength > 32 || blob.size < HEADER_BYTES + ivLength + TAG_BYTES) {
            throw IllegalArgumentException("secret blob has an invalid IV")
        }
        val iv = blob.copyOfRange(HEADER_BYTES, HEADER_BYTES + ivLength)
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.doFinal(blob, HEADER_BYTES + ivLength, blob.size - HEADER_BYTES - ivLength)
        } catch (e: AEADBadTagException) {
            throw IllegalArgumentException("secret blob is corrupt")
        } catch (e: KeyPermanentlyInvalidatedException) {
            throw SecretUnavailableException()
        } catch (e: BadPaddingException) {
            throw IllegalArgumentException("secret blob is corrupt")
        } catch (e: GeneralSecurityException) {
            throw SecretUnavailableException()
        }
    }

    private fun loadOrCreateKey(): Pair<SecretKey, Boolean> {
        val existing = try {
            keyStore.getKey(KEY_ALIAS, null) as? SecretKey
        } catch (e: UnrecoverableKeyException) {
            // The key exists but its material is gone (lock-screen change, Keystore reset).
            throw SecretUnavailableException()
        } catch (e: GeneralSecurityException) {
            throw SecretUnavailableException()
        }
        if (existing != null) {
            return existing to isStrongBoxBacked(existing)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return generateKey(strongBox = true) to true
            } catch (_: StrongBoxUnavailableException) {
                // The device has no secure element, or its StrongBox is full.
            } catch (_: ProviderException) {
                // Some vendors throw this instead of StrongBoxUnavailableException.
            } catch (_: GeneralSecurityException) {
                // Fall through to the TEE-backed key.
            }
        }
        return try {
            generateKey(strongBox = false) to false
        } catch (e: GeneralSecurityException) {
            throw SecretUnavailableException()
        }
    }

    private fun generateKey(strongBox: Boolean): SecretKey {
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(false)
            .setRandomizedEncryptionRequired(true)
        if (strongBox) {
            builder.setIsStrongBoxBacked(true)
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(builder.build())
        return generator.generateKey()
    }

    /** True only when the Keystore reports the key lives in a secure element. */
    private fun isStrongBoxBacked(candidate: SecretKey): Boolean = runCatching {
        val factory = KeyFactory.getInstance(candidate.algorithm, KEYSTORE)
        val info = factory.getKeySpec(candidate, KeyInfo::class.java) as KeyInfo
        info.isInsideSecureHardware
    }.getOrDefault(false)
}
