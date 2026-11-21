package dev.leocode

import android.app.Activity
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import dev.leocode.core.CrashRecord
import dev.leocode.core.CrashStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Native recovery screen (Task 8). Opened by MainActivity when the previous
 * process died with an uncaught exception, or when the WebView renderer is lost
 * twice within a minute.
 *
 * It is deliberately independent of the WebView and of [AppGraph]: whatever
 * broke the IDE must not be needed to show this screen. Diagnostics are
 * redacted by [CrashStore.shareText] before they reach the Share sheet.
 */
class RecoveryActivity : Activity() {

    companion object {
        const val EXTRA_CRASH = "dev.leocode.extra.CRASH"
        const val EXTRA_REASON = "dev.leocode.extra.REASON"
        const val EXTRA_MESSAGE = "dev.leocode.extra.MESSAGE"
        const val REASON_RENDERER = "renderer"
        const val REASON_STARTUP = "startup"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val theme = ThemeManager(this)
        theme.applyToWindow()

        val record = CrashStore.decode(intent.getStringExtra(EXTRA_CRASH))
        val rendererLoss = intent.getStringExtra(EXTRA_REASON) == REASON_RENDERER
        val startupMessage = intent.getStringExtra(EXTRA_MESSAGE)
        val startupFailure = !startupMessage.isNullOrBlank()
        val dark = theme.isDark()
        val textColor = if (dark) 0xFFE6E9EF.toInt() else 0xFF1B2028.toInt()
        val dimColor = if (dark) 0xFF8B93A3.toInt() else 0xFF6E7787.toInt()

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(24), dp(32), dp(24), dp(32))
            setBackgroundColor(theme.background())
        }

        column.addView(text(
            when {
                startupFailure -> "LeoCode could not start"
                rendererLoss -> "Restored after a problem"
                else -> "LeoCode closed unexpectedly"
            },
            24f, textColor, Typeface.BOLD
        ))
        column.addView(text(
            when {
                startupFailure ->
                    "The app could not open its workspace, so it stopped before the IDE loaded. " +
                        "Nothing on disk was changed by this attempt."
                rendererLoss ->
                    "The web view stopped twice in under a minute. Your files and workspace are unchanged."
                else ->
                    "The previous session ended with an unexpected error. Your files and workspace are unchanged."
            },
            15f, dimColor, Typeface.NORMAL
        ).apply { setPadding(0, dp(12), 0, dp(20)) })

        if (startupFailure) {
            column.addView(text(startupMessage!!, 13f, textColor, Typeface.NORMAL).apply {
                typeface = Typeface.MONOSPACE
                setTextIsSelectable(true)
                setPadding(0, 0, 0, dp(20))
            })
        }

        if (record != null) {
            column.addView(text(summary(record), 13f, textColor, Typeface.NORMAL).apply {
                typeface = Typeface.MONOSPACE
                setTextIsSelectable(true)
                setPadding(0, 0, 0, dp(20))
            })
        }

        column.addView(button("Restart LeoCode") {
            startActivity(
                Intent(this@RecoveryActivity, MainActivity::class.java).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
                }
            )
            finish()
        })

        if (record != null) {
            column.addView(button("Share diagnostics") {
                val send = Intent(Intent.ACTION_SEND).apply {
                    type = "text/plain"
                    putExtra(Intent.EXTRA_SUBJECT, "LeoCode diagnostics")
                    putExtra(Intent.EXTRA_TEXT, CrashStore.shareText(record))
                }
                startActivity(Intent.createChooser(send, "Share diagnostics"))
            })
        }

        column.addView(button("Close") { finish() })

        column.addView(text(
            "Diagnostics are redacted before sharing: file paths and credentials are removed.",
            12f, dimColor, Typeface.NORMAL
        ).apply { setPadding(0, dp(20), 0, 0) })

        setContentView(ScrollView(this).apply { addView(column) })
    }

    private fun summary(record: CrashRecord): String {
        val whenText = SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
            .format(Date(record.timestamp))
        return buildString {
            appendLine("When: $whenText")
            appendLine("Thread: ${record.thread}")
            appendLine("Error: ${record.exception}")
            if (record.message.isNotBlank()) appendLine(record.message)
            appendLine()
            appendLine(record.stack.lineSequence().take(24).joinToString("\n"))
        }
    }

    private fun text(value: String, size: Float, color: Int, style: Int) =
        TextView(this).apply {
            text = value
            textSize = size
            setTextColor(color)
            typeface = Typeface.create(Typeface.DEFAULT, style)
        }

    private fun button(label: String, onClick: () -> Unit) =
        Button(this).apply {
            text = label
            isAllCaps = false
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
            setOnClickListener { onClick() }
        }

    private fun dp(value: Int): Int =
        (value * resources.displayMetrics.density).toInt()
}
