package dev.leocode

import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** L-11: the insets script the Activity evaluates on the page. */
class InsetsScriptTest {

    @Test
    fun `publishes every inset property`() {
        val js = InsetsScript.build(
            topPx = 24f,
            bottomPx = 48f,
            leftPx = 0f,
            rightPx = 32f,
            imeBottomPx = 300f
        )
        assertTrue(js.contains("'--inset-top','24.0px'"))
        assertTrue(js.contains("'--inset-bottom','48.0px'"))
        // The two that were missing before L-11.
        assertTrue(js.contains("'--inset-left','0.0px'"))
        assertTrue(js.contains("'--inset-right','32.0px'"))
        assertTrue(js.contains("'--ime-bottom','300.0px'"))
        assertEquals(5, Regex("setProperty").findAll(js).count())
        assertTrue(js.endsWith("px');"))
    }

    @Test
    fun `formats decimals with a dot whatever the locale is`() {
        val original = Locale.getDefault()
        try {
            // A comma decimal separator would make "24,0px" invalid CSS and every
            // padded surface would collapse.
            Locale.setDefault(Locale.GERMANY)
            val js = InsetsScript.build(
                topPx = 24.5f,
                bottomPx = 1.25f,
                leftPx = 3f,
                rightPx = 4f,
                imeBottomPx = 0f
            )
            assertTrue(js.contains("24.5px"))
            assertTrue(js.contains("1.3px"))
            assertFalse(js.contains("24,5"))
            assertFalse(js.contains("1,3"))
        } finally {
            Locale.setDefault(original)
        }
    }

    @Test
    fun `the larger of the system bar and the cutout wins`() {
        // A notch is deeper than the status bar; side cutouts exceed the bars.
        assertEquals(96, InsetsScript.widest(bars = 63, cutout = 96))
        assertEquals(63, InsetsScript.widest(bars = 63, cutout = 0))
        assertEquals(0, InsetsScript.widest(bars = 0, cutout = 0))
        assertEquals(44, InsetsScript.widest(bars = 44, cutout = 44))
    }
}
