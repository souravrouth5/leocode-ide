package dev.leocode.core

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.util.Properties

/**
 * Remembers the highest `versionCode` installed per runtime (Task 25).
 *
 * A signed manifest is still replayable: an attacker who controls the download
 * server can serve yesterday's validly signed package. The rollback counter is
 * app-private state, so a manifest whose `versionCode` is lower than the one
 * recorded here is refused.
 */
class RuntimeStateStore(private val file: File) {

    fun installedVersion(id: String): Int? =
        read().getProperty(key(id))?.toIntOrNull()

    fun record(id: String, versionCode: Int) {
        val values = read()
        values[key(id)] = versionCode.toString()
        write(values)
    }

    fun clear(id: String) {
        val values = read()
        if (values.remove(key(id)) != null) write(values)
    }

    private fun key(id: String) = "$id.versionCode"

    private fun read(): Properties {
        val values = Properties()
        if (!file.isFile) return values
        runCatching {
            FileInputStream(file).use { values.load(it) }
        }
        return values
    }

    /** Write through a sibling temp file so a crash cannot truncate the counter. */
    private fun write(values: Properties) {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, file.name + ".tmp")
        FileOutputStream(temp).use { output ->
            values.store(output, "installed runtime versions")
            output.fd.sync()
        }
        if (!temp.renameTo(file)) {
            file.delete()
            if (!temp.renameTo(file)) {
                temp.delete()
                throw RuntimeInstallException("E_IO", "cannot record the installed runtime version")
            }
        }
    }
}
