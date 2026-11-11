package dev.leocode.bridge.types

import dev.leocode.bridge.BridgeTypesGenerator
import dev.leocode.bridge.ErrorCode
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Drift guard for Task 7: every `@Serializable` DTO declared in `Contract.kt` must reach the
 * generated TypeScript, and every [ErrorCode] must appear in `ERROR_CODES`. A new DTO that is
 * not added to the generator's seed list fails here, not silently in the web build.
 */
class BridgeTypesCoverageTest {

    private val generated: String by lazy { BridgeTypesGenerator.generate() }

    @Test
    fun `every serializable DTO in Contract kt is generated`() {
        val source = File("src/main/java/dev/leocode/bridge/Contract.kt").readText()
        val names = Regex("""@Serializable\s+(?:data\s+)?class\s+(\w+)""")
            .findAll(source)
            .map { it.groupValues[1] }
            .toList()

        assertTrue("no DTOs found; the regex or the path is wrong", names.isNotEmpty())
        val missing = names.filterNot { generated.contains("export interface $it {") }
        assertTrue("DTOs missing from the generated types: $missing", missing.isEmpty())
    }

    @Test
    fun `every ErrorCode is in ERROR_CODES`() {
        val missing = ErrorCode.entries
            .map { it.code }
            .filterNot { generated.contains("  \"$it\",") }
        assertTrue("error codes missing from ERROR_CODES: $missing", missing.isEmpty())
    }
}
