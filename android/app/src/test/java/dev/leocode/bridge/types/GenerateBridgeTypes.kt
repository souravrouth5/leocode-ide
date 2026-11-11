package dev.leocode.bridge.types

import dev.leocode.bridge.BridgeTypesGenerator
import java.io.File

/**
 * Entry point for the Gradle `generateBridgeTypes` task (Task 7).
 *
 * Usage: `./gradlew generateBridgeTypes` from `android/`. The task passes the
 * target path as the first argument.
 */
fun main(args: Array<String>) {
    val target = File(args.firstOrNull() ?: "web/src/bridge/types.gen.ts")
    target.parentFile?.mkdirs()
    target.writeText(BridgeTypesGenerator.generate())
    println("wrote ${target.absolutePath} (${target.length()} bytes)")
}
