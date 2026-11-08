package dev.leocode

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WebAppBridgeOriginTest {

    @Test
    fun `allows appassets origin in both release and debug`() {
        assertTrue(
            WebAppBridge.isOriginAllowed(
                scheme = "https",
                host = "appassets.androidplatform.net",
                isDebug = false
            )
        )
        assertTrue(
            WebAppBridge.isOriginAllowed(
                scheme = "https",
                host = "appassets.androidplatform.net",
                isDebug = true
            )
        )
    }

    @Test
    fun `rejects dev server origins in release build`() {
        assertFalse(
            WebAppBridge.isOriginAllowed(
                scheme = "http",
                host = "localhost",
                port = 5173,
                isDebug = false
            )
        )
        assertFalse(
            WebAppBridge.isOriginAllowed(
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
            WebAppBridge.isOriginAllowed(
                scheme = "http",
                host = "localhost",
                port = 5173,
                isDebug = true
            )
        )
        assertTrue(
            WebAppBridge.isOriginAllowed(
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
            WebAppBridge.isOriginAllowed(
                scheme = "http",
                host = "192.168.1.100",
                port = 5173,
                isDebug = true,
                extraOrigins = extraOrigins
            )
        )
        assertFalse(
            WebAppBridge.isOriginAllowed(
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
            WebAppBridge.isOriginAllowed(
                scheme = "http",
                host = "malicious.com",
                port = 5173,
                isDebug = true
            )
        )
        assertFalse(
            WebAppBridge.isOriginAllowed(
                scheme = "https",
                host = "evil.org",
                port = 443,
                isDebug = true
            )
        )
    }

    @Test
    fun `string overload correctly parses and validates origins`() {
        assertTrue(WebAppBridge.isOriginAllowed("https://appassets.androidplatform.net", isDebug = false))
        assertTrue(WebAppBridge.isOriginAllowed("http://localhost:5173", isDebug = true))
        assertTrue(WebAppBridge.isOriginAllowed("http://127.0.0.1:5173", isDebug = true))
        assertFalse(WebAppBridge.isOriginAllowed("http://localhost:5173", isDebug = false))
        assertFalse(WebAppBridge.isOriginAllowed("http://attacker.com:5173", isDebug = true))
    }
}
