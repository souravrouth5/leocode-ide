package dev.leocode.core.language

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class LanguageRegistryTest {

    private class FakeProvider(
        override val id: String = "fake",
        override val displayName: String = "Fake Language",
        override val runtimeId: String? = "fake-runtime",
        override val extensions: List<String> = listOf("fake", "fk"),
        override val supportsRepl: Boolean = true,
        override val trustTriggers: List<String> = listOf("script"),
        override val requiresRuntime: Boolean = false
    ) : LanguageProvider {
        override fun buildRunCommand(projectDir: File, fileRelPath: String): RunCommandPlan =
            RunCommandPlan(argv = listOf("fake-run", fileRelPath), env = mapOf("FAKE" to "1"), cwd = projectDir)
    }

    @Test
    fun `registers and looks up provider by id and extension`() {
        val registry = LanguageRegistry()
        val fake = FakeProvider()
        registry.register(fake)

        assertEquals(fake, registry.get("fake"))
        assertEquals(fake, registry.findForFile("test.fake"))
        assertEquals(fake, registry.findForFile("dir/sub/main.FK"))
        assertEquals(1, registry.all().size)
    }

    @Test
    fun `findForFile returns null for unknown extensions or files without extension`() {
        val registry = LanguageRegistry()
        registry.register(FakeProvider())

        assertNull(registry.findForFile("unknown.txt"))
        assertNull(registry.findForFile("Makefile"))
        assertNull(registry.findForFile(""))
    }

    @Test
    fun `unregisters provider cleanly`() {
        val registry = LanguageRegistry()
        val fake = FakeProvider()
        registry.register(fake)

        val removed = registry.unregister("fake")
        assertEquals(fake, removed)
        assertNull(registry.get("fake"))
        assertNull(registry.findForFile("test.fake"))
        assertTrue(registry.all().isEmpty())
    }

    @Test
    fun `initial providers are registered on creation`() {
        val fake = FakeProvider()
        val registry = LanguageRegistry(listOf(fake))

        assertEquals(fake, registry.get("fake"))
        assertEquals(1, registry.all().size)
    }
}
