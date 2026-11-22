package dev.leocode.bridge

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AppHandlerTest {

    private val json = Json { ignoreUnknownKeys = true }

    private fun appInfo(): AppInfo = AppInfo(
        app = "LeoCode",
        version = "0.1.0",
        mode = "android",
        theme = ThemeState("system", "dark")
    )

    private fun noTheme(): ThemePort = object : ThemePort {
        override fun state(): ThemeState = ThemeState("system", "dark")
        override fun setMode(mode: String?): ThemeState = state()
    }

    private fun call(
        handler: AppHandler,
        method: String,
        payload: JsonObject = JsonObject(emptyMap())
    ): JsonObject = handler.handle(method, payload).jsonObject

    @Test
    fun `diagnostics returns the injected report`() {
        val report = "LeoCode diagnostics\nApp : LeoCode 0.1.0\nRoot: not detected"
        val handler = AppHandler(
            noTheme(),
            { appInfo() },
            json,
            diagnostics = { report }
        )

        val reply = call(handler, "app.diagnostics")

        assertEquals(report, reply["report"]!!.jsonPrimitive.content)
        assertTrue(AppHandler.METHODS.contains("app.diagnostics"))
        assertTrue(handler.methods().contains("app.diagnostics"))
    }

    @Test
    fun `share redacts the text and reports the chooser result`() {
        var sharedText = ""
        val handler = AppHandler(
            noTheme(),
            { appInfo() },
            json,
            share = { text ->
                sharedText = text
                true
            }
        )

        val reply = call(
            handler,
            "app.share",
            buildJsonObject {
                put("text", "/data/data/dev.leocode/files/x token=abc123")
            }
        )

        assertEquals("true", reply["shared"]!!.jsonPrimitive.content)
        assertTrue(sharedText.contains("<path>"))
        assertTrue(sharedText.contains("<redacted>"))
        assertTrue(!sharedText.contains("/data/"))
        assertTrue(!sharedText.contains("abc123"))
    }

    @Test
    fun `share reports false when no chooser is available`() {
        val handler = AppHandler(noTheme(), { appInfo() }, json)

        val reply = call(
            handler,
            "app.share",
            buildJsonObject { put("text", "diagnostics") }
        )

        assertEquals("false", reply["shared"]!!.jsonPrimitive.content)
    }

    @Test
    fun `info still returns the app info fields`() {
        val handler = AppHandler(noTheme(), { appInfo() }, json)

        val reply = call(handler, "app.info")

        assertEquals("LeoCode", reply["app"]!!.jsonPrimitive.content)
        assertEquals("0.1.0", reply["version"]!!.jsonPrimitive.content)
        assertEquals("android", reply["mode"]!!.jsonPrimitive.content)
        val theme = reply["theme"]!!.jsonObject
        assertEquals("system", theme["mode"]!!.jsonPrimitive.content)
        assertEquals("dark", theme["effective"]!!.jsonPrimitive.content)
    }
}
