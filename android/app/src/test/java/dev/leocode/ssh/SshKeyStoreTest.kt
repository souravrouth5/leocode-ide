package dev.leocode.ssh

import dev.leocode.bridge.BridgeJson
import dev.leocode.bridge.SshKeyGenerateRequest
import dev.leocode.bridge.SshKeyImportRequest
import java.io.File
import java.io.IOException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Task 23: identities are generated/imported locally, only public data leaves
 * the store, and a passphrase is enforced on use.
 */
class SshKeyStoreTest {

    @Test
    fun `generates an ed25519 key and lists public data only`() {
        val store = keys()
        val info = store.generate(SshKeyGenerateRequest(type = "ed25519", comment = "phone"))

        assertEquals("ed25519", info.type)
        assertTrue(info.fingerprint.startsWith("SHA256:"))
        assertTrue(info.publicKey.startsWith("ssh-ed25519 "))
        assertTrue(info.publicKey.endsWith(" phone"))
        assertFalse(info.hasPassphrase)
        assertEquals(1, store.list().size)

        val pair = store.keyPair(info.id)
        assertEquals(Crypto.fingerprint(pair.public), info.fingerprint)
    }

    @Test
    fun `generates rsa at the requested size`() {
        val store = keys()
        val info = store.generate(SshKeyGenerateRequest(type = "rsa", bits = 2048))

        assertEquals("rsa", info.type)
        assertTrue(info.publicKey.startsWith("ssh-rsa "))
        assertTrue(store.keyPair(info.id).private.algorithm.equals("RSA", ignoreCase = true))
    }

    @Test(expected = IOException::class)
    fun `rejects an unsupported key type`() {
        keys().generate(SshKeyGenerateRequest(type = "dsa"))
    }

    @Test(expected = IOException::class)
    fun `rejects an odd rsa size`() {
        keys().generate(SshKeyGenerateRequest(type = "rsa", bits = 1024))
    }

    @Test
    fun `imports an OpenSSH ed25519 key`() {
        val store = keys()
        val info = store.import(SshKeyImportRequest(content = ED25519_OPENSSH, label = "laptop"))

        assertEquals("ed25519", info.type)
        assertEquals("laptop", info.label)
        assertNotNull(store.keyPair(info.id))
        assertTrue(info.publicKey.startsWith("ssh-ed25519 "))
    }

    @Test
    fun `imports a PEM rsa key`() {
        val store = keys()
        val info = store.import(SshKeyImportRequest(content = RSA_PEM))

        assertEquals("rsa", info.type)
        assertTrue(store.keyPair(info.id).private.algorithm.equals("RSA", ignoreCase = true))
    }

    @Test
    fun `passphrase is required to use the key`() {
        val store = keys()
        val info = store.generate(SshKeyGenerateRequest(type = "ed25519", passphrase = "hunter2"))

        assertTrue(info.hasPassphrase)
        assertFailsWith("passphrase") { store.keyPair(info.id) }
        assertFailsWith("passphrase") { store.keyPair(info.id, "wrong") }
        assertEquals(info.fingerprint, Crypto.fingerprint(store.keyPair(info.id, "hunter2").public))
    }

    @Test
    fun `delete removes the metadata and the sealed private key`() {
        val store = keys()
        val info = store.generate(SshKeyGenerateRequest())

        assertTrue(store.delete(info.id))
        assertFalse(store.delete(info.id))
        assertTrue(store.list().isEmpty())
        assertFailsWith("no such SSH key") { store.keyPair(info.id) }
    }

    @Test
    fun `metadata file never contains private key material`() {
        val root = root()
        val store = keys(root)
        store.generate(SshKeyGenerateRequest(type = "ed25519"))
        store.import(SshKeyImportRequest(content = ED25519_OPENSSH))

        val metadata = File(root, "ssh/keys.json").readText()
        assertFalse(metadata.contains("PRIVATE"))
        assertFalse(metadata.contains("OPENSSH PRIVATE KEY"))
        // The fixture's PKCS#8 base64 must not leak into the metadata either.
        val pair = store.keyPair(store.list().first().id)
        val encoded = java.util.Base64.getEncoder().encodeToString(pair.private.encoded)
        assertFalse(metadata.contains(encoded))
    }

    @Test
    fun `two generated keys get distinct fingerprints`() {
        val store = keys()
        val first = store.generate(SshKeyGenerateRequest(type = "ed25519"))
        val second = store.generate(SshKeyGenerateRequest(type = "ed25519"))

        assertTrue(first.fingerprint != second.fingerprint)
        assertEquals(2, store.list().size)
    }

    private fun keys(directory: File = root()): SshKeyStore =
        SshKeyStore(File(directory, "ssh"), TestSecrets.store(directory), BridgeJson.value)

    private fun root(): File =
        java.nio.file.Files.createTempDirectory("ssh-keys").toFile().also { it.deleteOnExit() }

    private inline fun assertFailsWith(fragment: String, block: () -> Unit) {
        try {
            block()
            throw AssertionError("expected IOException containing '$fragment'")
        } catch (e: IOException) {
            assertTrue("message was '${e.message}'", e.message?.contains(fragment) == true)
        }
    }

    private companion object {
        val ED25519_OPENSSH = """
            -----BEGIN OPENSSH PRIVATE KEY-----
            b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
            QyNTUxOQAAACBYZm5d8JLpWnurlV8eD9QvOkDfIbTByKoztnnQ5bVzvQAAAJB4Kbx5eCm8
            eQAAAAtzc2gtZWQyNTUxOQAAACBYZm5d8JLpWnurlV8eD9QvOkDfIbTByKoztnnQ5bVzvQ
            AAAEAl2asC/3BXAq649S+mng6D3ue1Y7G0Ktgtq3k9x8MgQVhmbl3wkulae6uVXx4P1C86
            QN8htMHIqjO2edDltXO9AAAADWltcG9ydGVkQHRlc3Q=
            -----END OPENSSH PRIVATE KEY-----
        """.trimIndent()

        val RSA_PEM = """
            -----BEGIN RSA PRIVATE KEY-----
            MIIEpAIBAAKCAQEAuknPjYVkzp9hOhXizZyzRtxEO+O5yswdkt9fQopSu9AFcRJg
            4SRxIpL7OQJmq4K7syRDQgNOVtsTSmVi7bKxja48ELB2N00PXV2qTxSdLIkt91yp
            jZ0DuSKMnv3Xe0UiKb7O/SkbwipvRNW6cyFD/VTUqIzR/VRq8XfyYqs61RGyPYuZ
            cmTBemrDTbPxOyKpDQjLKeQGiDqeQjP3Aa9SrzRKtSqOD0DgcvPuVPPm3nsf/apV
            5MZLSOGQsFlVaECvI+6hu3EO1HMUolqNOu8jlamDVbN/pPeDGhixbhDyholLgniH
            UDtTo6wsW7PP9OpLgOkHyKWVaOLL+GgK09pI+QIDAQABAoIBAArqjhpqi4+VlJiX
            JXsbwIApomh5hd7BwwZjJ0WCjkpR7G21sF5lGKmYYBcVQk+w2Z+r43KT98RcclcQ
            1aEc8G1fXUbzljvTnM/BcDxR1ouAbuSAxjFFlw0jXobnFFhVguTcGOxKG0Wvn6VS
            mmpKc93dmZgWZ2w/RQSJHTeltcz8MsKRzqv0PIN4NfZA3bblwnIorUwEmm2Cl1Ut
            MNWYhz9riQ/HH2xAxxXAd8bW5xFgyVFK/j3Te7uozSaH1xGdqgMWDnzkbVfiDLfU
            UdhBYQ/kKBvkPQUhQJG1RZaNqqzzRBbN/mN8D8HoGFnmmL0bvZ4FRSlgyAAEHMFK
            mCE/o7ECgYEA3v/fb9rcdPdVDUpWK1scgvNxCh+X++YHFjBCdC4OJWYHFcQtITeF
            CynkCSbUHR2lHGbh8St6nSn/suo5dRguo1L1IOX2gw12gimWR7qlU5BLuOhXuQRs
            zWYPU+IlsRgg10uEziaq26IjyqjecVoup6ZIl2ZbRIG3X+m0Q7wtfSkCgYEA1dsr
            V6Das4nLUII/q3GFFqpNxcbaGRMbDX9fcPWV3ywCtC7c/4/JJIRxxoM+3cHyEr+3
            ZrGqKr+7H9qKMUqHzzjiiK2fIHEtWA99uaBeyhQZsGSnIfw9XufzUIJti1U7Jb4b
            u0N7VolQCV/HRRwjbFeOK5jydS39ER9rQ9lfF1ECgYAMKF0RJxh/1AAyEkxyXqxG
            Q2l1SNWraRYX0pe858njphVazXA8cF9zhVwmV5SW5cfbrYxB7sHnkaOcKILrbF8W
            jm5I1eDDslc0r3m+/WEIFkTalug5cRFRfW/2fczaQ9t+gWKDLr5/7O4QnXZLLcR/
            ZWRtxKnTKVNLCl3Gl5rPSQKBgQCvFw9IYmlM3393vfwVCQ92/B5K1EESkILwrR1e
            JaP8IVNhZJEKKBX98PYaGrCo7TadxRuKV+HDuFCjhtDoBGZm8eL/Fm+XJzKBy8Ua
            6sNQ3d4efnocKCGzB2M9wluf3Ttc7mZUDq73rdq6ohFLcvtJo/HBniq8Z9evYjL3
            TQw+0QKBgQCIUOCLCT/ymVbwFcTQXxvU198ABywT5IC2Cv2v6XnBVSsn2xsWV1Zp
            DY7doIQKAXr3uCqB/3tY/W5uRgM5v10cZdYD4Q99Y7azpbS9o3dPvk2tOAXwmMo+
            p0tuhwhnAQ6e+qbPMRkLC+Fsj1xibTBmvRLay4g1W6M70PZXPkjZUA==
            -----END RSA PRIVATE KEY-----
        """.trimIndent()
    }
}
