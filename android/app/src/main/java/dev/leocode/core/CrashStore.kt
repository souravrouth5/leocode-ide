package dev.leocode.core

import android.content.Context
import android.os.Build
import dev.leocode.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Last-crash hand-off between process death and the next launch (Task 8).
 *
 * [install] wraps the default uncaught-exception handler: the record is written
 * atomically and redacted, then the previous handler runs unchanged so the
 * platform still shows its own crash flow. The next launch calls [consume] and
 * opens [dev.leocode.RecoveryActivity] instead of the IDE.
 *
 * The message and the stack are capped before the record is written or shared
 * (L-20): the record travels as an Intent extra (1 MB Binder limit) and as
 * `EXTRA_TEXT`, so a multi-megabyte stack would either throw in `startActivity`
 * or produce a share payload nobody can read.
 */
@Serializable
data class CrashRecord(
    val timestamp: Long,
    val thread: String,
    val exception: String,
    val message: String,
    val stack: String,
    val appVersion: String,
    val sdk: Int,
    val release: String,
    val model: String,
    val manufacturer: String
)

object CrashStore {

    private const val DIR = "crash"
    private const val FILE = "last-crash.json"
    private val json = Json { ignoreUnknownKeys = true; prettyPrint = true }

    /** Message cap: enough for the exception text, small enough for any Intent. */
    const val MAX_MESSAGE_CHARS = 4 * 1024

    /** Stack caps: both apply, whichever is reached first wins. */
    const val MAX_STACK_CHARS = 16 * 1024
    const val MAX_STACK_LINES = 64

    private const val MESSAGE_NOTE = "\n… (message truncated)"
    private const val STACK_NOTE = "\n… (stack truncated)"

    /** Install once, in Application.onCreate, before anything can throw. */
    fun install(context: Context) {
        val app = context.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
            runCatching { write(app, record(thread, throwable)) }
            previous?.uncaughtException(thread, throwable)
        }
    }

    /** Returns the pending crash once, deleting it so the next launch is normal. */
    fun consume(context: Context): CrashRecord? {
        val file = file(context)
        if (!file.isFile) return null
        val record = runCatching {
            json.decodeFromString<CrashRecord>(file.readText())
        }.getOrNull()
        file.delete()
        return record
    }

    fun clear(context: Context) {
        file(context).delete()
    }

    /** Serialises for the Intent that opens RecoveryActivity. Always capped. */
    fun encode(record: CrashRecord): String =
        json.encodeToString(CrashRecord.serializer(), capped(record))

    fun decode(text: String?): CrashRecord? =
        if (text.isNullOrBlank()) null
        else runCatching { json.decodeFromString<CrashRecord>(text) }.getOrNull()

    /**
     * Applies the size caps (L-20). Every consumer — the file, the Intent and the
     * Share sheet — goes through here so an oversized record cannot escape.
     */
    fun capped(record: CrashRecord): CrashRecord = record.copy(
        message = capMessage(record.message),
        stack = capStack(record.stack)
    )

    /** Redacted, human-readable text for the system Share sheet. */
    fun shareText(record: CrashRecord): String {
        val safe = capped(record)
        val whenText = SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.US)
            .format(Date(safe.timestamp))
        val raw = buildString {
            appendLine("LeoCode diagnostics")
            appendLine("App: ${safe.appVersion}")
            appendLine("Device: ${safe.manufacturer} ${safe.model}, Android ${safe.release} (SDK ${safe.sdk})")
            appendLine("When: $whenText")
            appendLine("Thread: ${safe.thread}")
            appendLine("Exception: ${safe.exception}")
            appendLine("Message: ${safe.message}")
            appendLine()
            appendLine("Stack trace:")
            appendLine(safe.stack)
        }
        return Redactor.redact(raw)
    }

    private fun record(thread: Thread, throwable: Throwable): CrashRecord {
        val stack = throwable.stackTraceToString()
        return CrashRecord(
            timestamp = System.currentTimeMillis(),
            thread = thread.name,
            exception = throwable.javaClass.name,
            message = throwable.message ?: "",
            stack = stack,
            appVersion = BuildConfig.VERSION_NAME,
            sdk = Build.VERSION.SDK_INT,
            release = Build.VERSION.RELEASE ?: "",
            model = Build.MODEL ?: "",
            manufacturer = Build.MANUFACTURER ?: ""
        ).let { it.copy(message = Redactor.redact(it.message), stack = Redactor.redact(it.stack)) }
    }

    private fun write(context: Context, record: CrashRecord) {
        val file = file(context)
        file.parentFile?.mkdirs()
        AtomicWriter.write(file, encode(record).toByteArray(Charsets.UTF_8))
    }

    private fun file(context: Context): File =
        File(File(context.filesDir, DIR), FILE)

    private fun capMessage(message: String): String {
        if (message.length <= MAX_MESSAGE_CHARS) return message
        return takeChars(message, MAX_MESSAGE_CHARS - MESSAGE_NOTE.length) + MESSAGE_NOTE
    }

    private fun capStack(stack: String): String {
        val lines = stack.split('\n')
        val byLines = lines.size > MAX_STACK_LINES
        val head = if (byLines) lines.take(MAX_STACK_LINES).joinToString("\n") else stack
        if (byLines || head.length > MAX_STACK_CHARS) {
            val room = MAX_STACK_CHARS - STACK_NOTE.length
            return if (head.length > room) takeChars(head, room) + STACK_NOTE else head + STACK_NOTE
        }
        return head
    }

    /** `take` that never splits a surrogate pair, so the JSON stays valid UTF-16. */
    private fun takeChars(text: String, limit: Int): String {
        var end = limit.coerceIn(0, text.length)
        if (end in 1 until text.length &&
            Character.isHighSurrogate(text[end - 1]) &&
            Character.isLowSurrogate(text[end])
        ) {
            end -= 1
        }
        return text.substring(0, end)
    }
}
