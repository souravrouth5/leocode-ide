package dev.leocode.core

import android.content.pm.PackageManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

/**
 * API 28/29/33 only call `PackageParser.collectCertificates()` for an APK
 * archive when `GET_SIGNATURES` is set, so `signingInfo` is null even though
 * `GET_SIGNING_CERTIFICATES` was requested. Asking for both flags keeps the
 * signer check working on D1 (API 28) and newer devices.
 */
class UpdateInstallerFlagsTest {

    @Test
    fun `archive lookup requests legacy signatures as well`() {
        assertEquals(
            PackageManager.GET_SIGNING_CERTIFICATES or PackageManager.GET_SIGNATURES,
            UpdateInstaller.PackageManagerFlags.SIGNING
        )
        assertNotEquals(
            0,
            UpdateInstaller.PackageManagerFlags.SIGNING and PackageManager.GET_SIGNATURES
        )
    }
}
