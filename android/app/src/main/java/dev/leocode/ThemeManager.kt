package dev.leocode

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.view.View
import android.view.WindowManager

/**
 * Light / dark / system theme, persisted in SharedPreferences.
 *
 * The WebView owns the real UI, so this class has two jobs:
 *  1. tell the web layer which theme is active (bridge + JS event), and
 *  2. keep the Android system bars and the window background in sync, so there is
 *     no white flash before the page paints and no mismatched status bar afterwards.
 */
class ThemeManager(private val activity: Activity) {

    companion object {
        const val MODE_SYSTEM = "system"
        const val MODE_LIGHT = "light"
        const val MODE_DARK = "dark"

        private const val PREFS = "leocode.settings"
        private const val KEY_MODE = "theme.mode"

        // Keep in sync with --bg in web/src/styles.css.
        private const val BG_DARK = 0xFF0F1115.toInt()
        private const val BG_LIGHT = 0xFFF7F8FA.toInt()
    }

    private val prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private var current: String = normalize(prefs.getString(KEY_MODE, MODE_SYSTEM))

    val mode: String get() = current

    fun isDark(): Boolean = when (current) {
        MODE_LIGHT -> false
        MODE_DARK -> true
        else -> {
            val night = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
            night == Configuration.UI_MODE_NIGHT_YES
        }
    }

    fun effective(): String = if (isDark()) MODE_DARK else MODE_LIGHT

    /** Returns true when the stored mode actually changed. */
    fun setMode(value: String?): Boolean {
        val next = normalize(value)
        val changed = next != current
        current = next
        prefs.edit().putString(KEY_MODE, next).apply()
        return changed
    }

    fun background(): Int = if (isDark()) BG_DARK else BG_LIGHT

    /** Must be called on the UI thread. */
    fun applyToWindow() {
        val dark = isDark()
        val bg = background()
        val window = activity.window
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        window.statusBarColor = bg
        window.navigationBarColor = bg

        var flags = window.decorView.systemUiVisibility
        flags = flags or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        flags = if (dark) {
            flags and View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR.inv()
        } else {
            flags or View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags = if (dark) {
                flags and View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR.inv()
            } else {
                flags or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
            }
        }
        window.decorView.systemUiVisibility = flags
        window.decorView.setBackgroundColor(bg)
    }

    private fun normalize(value: String?): String = when (value) {
        MODE_LIGHT, MODE_DARK, MODE_SYSTEM -> value
        else -> MODE_SYSTEM
    }
}
