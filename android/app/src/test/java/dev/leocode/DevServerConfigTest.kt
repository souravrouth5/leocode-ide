package dev.leocode

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DevServerConfigTest {

    @Test
    fun `buildPageUrl appends query string correctly`() {
        val url = DevServerConfig.buildPageUrl("http://localhost:5173", "system", "dark")
        assertEquals("http://localhost:5173?mode=system&theme=dark", url)

        val urlWithExistingQuery = DevServerConfig.buildPageUrl("http://localhost:5173/?foo=bar", "system", "dark")
        assertEquals("http://localhost:5173/?foo=bar&mode=system&theme=dark", urlWithExistingQuery)
    }

    @Test
    fun `resolveDevUrl prefers reachable extraDevUrl when provided`() {
        val resolved = DevServerConfig.resolveDevUrl("http://192.168.1.50:5173") { url ->
            url == "http://192.168.1.50:5173"
        }
        assertEquals("http://192.168.1.50:5173", resolved)
    }

    @Test
    fun `resolveDevUrl falls back to localhost if extraDevUrl is unreachable`() {
        val resolved = DevServerConfig.resolveDevUrl("http://192.168.1.50:5173") { url ->
            url == DevServerConfig.DEV_URL_DEFAULT
        }
        assertEquals(DevServerConfig.DEV_URL_DEFAULT, resolved)
    }

    @Test
    fun `resolveDevUrl falls back to 127_0_0_1 if localhost is unreachable`() {
        val resolved = DevServerConfig.resolveDevUrl(null) { url ->
            url == DevServerConfig.DEV_URL_LOOPBACK
        }
        assertEquals(DevServerConfig.DEV_URL_LOOPBACK, resolved)
    }

    @Test
    fun `resolveDevUrl returns null when no dev server is reachable`() {
        val resolved = DevServerConfig.resolveDevUrl(null) { false }
        assertNull(resolved)
    }
}
