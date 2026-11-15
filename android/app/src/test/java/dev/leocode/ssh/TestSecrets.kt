package dev.leocode.ssh

import dev.leocode.core.secrets.SecretCipher
import java.io.File
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Test-only AES-GCM cipher so the store can run without the Android Keystore. */
internal object TestSecrets {
    private val key: SecretKey =
        KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

    fun store(root: File): dev.leocode.core.secrets.FileSecretStore =
        dev.leocode.core.secrets.FileSecretStore(File(root, "secrets"), cipher())

    fun cipher(): SecretCipher = object : SecretCipher {
        override fun seal(plaintext: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key)
            val encrypted = cipher.doFinal(plaintext)
            return "FAKE".toByteArray() + cipher.iv + encrypted
        }

        override fun open(blob: ByteArray): ByteArray {
            require(blob.size > 16 && String(blob.copyOfRange(0, 4), Charsets.US_ASCII) == "FAKE")
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, blob.copyOfRange(4, 16)))
            return cipher.doFinal(blob, 16, blob.size - 16)
        }
    }
}
