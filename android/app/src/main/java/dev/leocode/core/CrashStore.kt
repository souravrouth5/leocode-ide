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

    /** Serialises for the Intent that opens RecoveryActivity. */
    fun encode(record: CrashRecord): String = json.encodeToString(CrashRecord.serializer(), record)

    fun decode(text: String?): CrashRecord? =
        if (text.isNullOrBlank()) null
        else runCatching { json.decodeFromString<CrashRecord>(text) }.getOrNull()

    /** Redacted, human-readable text for the system Share sheet. */
    fun shareText(record: CrashRecord): String {
        val whenText = SimpleDateFormat("yyyy-MM-dd HH:mm:ss Z", Locale.US)
            .format(Date(record.timestamp))
        val raw = buildString {
            appendLine("LeoCode diagnostics")
            appendLine("App: ${record.appVersion}")
            appendLine("Device: ${record.manufacturer} ${record.model}, Android ${record.release} (SDK ${record.sdk})")
            appendLine("When: $whenText")
            appendLine("Thread: ${record.thread}")
            appendLine("Exception: ${record.exception}")
            appendLine("Message: ${record.message}")
            appendLine()
            appendLine("Stack trace:")
            appendLine(record.stack)
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
}
