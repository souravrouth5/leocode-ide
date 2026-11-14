package dev.leocode

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BridgeHostOriginTest {

    @Test
    fun `allows appassets origin in both release and debug`() {
        assertTrue(
            BridgeHost.isOriginAllowed(
                scheme = "https",
                host = "appassets.androidplatform.net",
                isDebug = false
            )
        )
        assertTrue(
            BridgeHost.isOriginAllowed(
                scheme = "https",
                host = "appassets.androidplatform.net",
                isDebug = true
            )
        )
    }

    @Test
    fun `rejects dev server origins in release build`() {
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "localhost",
                port = 5173,
                isDebug = false
            )
        )
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "127.0.0.1",
                port = 5173,
                isDebug = false
            )
        )
    }

    @Test
    fun `allows localhost and 127_0_0_1 on port 5173 in debug build`() {
        assertTrue(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "localhost",
                port = 5173,
                isDebug = true
            )
        )
        assertTrue(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "127.0.0.1",
                port = 5173,
                isDebug = true
            )
        )
    }

    @Test
    fun `allows custom extra origin in debug build`() {
        val extraOrigins = setOf("http://192.168.1.100:5173")
        assertTrue(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "192.168.1.100",
                port = 5173,
                isDebug = true,
                extraOrigins = extraOrigins
            )
        )
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "192.168.1.100",
                port = 5173,
                isDebug = false,
                extraOrigins = extraOrigins
            )
        )
    }

    @Test
    fun `rejects untrusted foreign origins even in debug`() {
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "malicious.com",
                port = 5173,
                isDebug = true
            )
        )
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "https",
                host = "evil.org",
                port = 443,
                isDebug = true
            )
        )
    }

    @Test
    fun `string overload correctly parses and validates origins`() {
        assertTrue(BridgeHost.isOriginAllowed("https://appassets.androidplatform.net", isDebug = false))
        assertTrue(BridgeHost.isOriginAllowed("http://localhost:5173", isDebug = true))
        assertTrue(BridgeHost.isOriginAllowed("http://127.0.0.1:5173", isDebug = true))
        assertFalse(BridgeHost.isOriginAllowed("http://localhost:5173", isDebug = false))
        assertFalse(BridgeHost.isOriginAllowed("http://attacker.com:5173", isDebug = true))
    }

    // ------------------------------------------------------------------- B-17

    @Test
    fun `appassets origin is allowed on the default https port only`() {
        // `Uri`/`URI` report an absent port as -1 and an explicit 443 as 443.
        assertTrue(
            BridgeHost.isOriginAllowed(
                scheme = "https",
                host = "appassets.androidplatform.net",
                port = -1,
                isDebug = false
            )
        )
        assertTrue(
            BridgeHost.isOriginAllowed(
                scheme = "https",
                host = "appassets.androidplatform.net",
                port = 443,
                isDebug = false
            )
        )
        // A port is part of the origin: :8443 is a different origin, and the
        // asset loader never serves it.
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "https",
                host = "appassets.androidplatform.net",
                port = 8443,
                isDebug = false
            )
        )
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "https",
                host = "appassets.androidplatform.net",
                port = 8080,
                isDebug = true
            )
        )
    }

    @Test
    fun `a non-default appassets port is rejected by the string overload too`() {
        assertFalse(
            BridgeHost.isOriginAllowed("https://appassets.androidplatform.net:8443", isDebug = false)
        )
        assertFalse(
            BridgeHost.isOriginAllowed("https://appassets.androidplatform.net:8443", isDebug = true)
        )
        assertTrue(
            BridgeHost.isOriginAllowed("https://appassets.androidplatform.net:443", isDebug = false)
        )
    }

    @Test
    fun `a plain http appassets origin is never allowed`() {
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "appassets.androidplatform.net",
                port = -1,
                isDebug = true
            )
        )
    }

    @Test
    fun `the debug localhost rule is unaffected by the port check`() {
        assertTrue(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "localhost",
                port = 5173,
                isDebug = true
            )
        )
        assertFalse(
            BridgeHost.isOriginAllowed(
                scheme = "http",
                host = "localhost",
                port = 5174,
                isDebug = true
            )
        )
    }

    @Test
    fun `only the default https port counts as default`() {
        assertTrue(BridgeHost.isDefaultHttpsPort(-1))
        assertTrue(BridgeHost.isDefaultHttpsPort(443))
        assertFalse(BridgeHost.isDefaultHttpsPort(0))
        assertFalse(BridgeHost.isDefaultHttpsPort(80))
        assertFalse(BridgeHost.isDefaultHttpsPort(8443))
    }
}
