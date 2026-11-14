package dev.leocode.workspace

import dev.leocode.core.FileHash
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class DraftsTest {

    private val root = createTempDir("drafts")
    private var workspaceId = "default"
    private val drafts = Drafts(root, { workspaceId })

    @Test
    fun `save read list and delete round-trip`() {
        drafts.save("src/main.py", "print('draft')", eol = "\r\n")

        val draft = drafts.read("src/main.py")
        assertEquals("print('draft')", draft?.content)
        assertEquals("\r\n", draft?.eol)
        assertTrue(draft!!.mtime > 0L)

        val listed = drafts.list()
        assertEquals(1, listed.size)
        assertEquals("src/main.py", listed.single().path)
        assertEquals("print('draft')".length, listed.single().size)

        assertTrue(drafts.delete("src/main.py"))
        assertNull(drafts.read("src/main.py"))
        assertTrue(drafts.list().isEmpty())
    }

    @Test
    fun `drafts are isolated per workspace`() {
        drafts.save("notes.txt", "one")
        workspaceId = "project-2"
        assertNull(drafts.read("notes.txt"))
        drafts.save("notes.txt", "two")

        workspaceId = "default"
        assertEquals("one", drafts.read("notes.txt")?.content)
        assertEquals(1, drafts.list().size)
    }

    @Test
    fun `deleteWorkspace removes only that workspace's drafts`() {
        drafts.save("a.txt", "a")
        workspaceId = "other"
        drafts.save("b.txt", "b")

        assertEquals(1, drafts.deleteWorkspace("other"))
        assertNull(drafts.read("b.txt"))

        workspaceId = "default"
        assertEquals("a", drafts.read("a.txt")?.content)
    }

    @Test
    fun `an oversized or blank draft is rejected`() {
        try {
            drafts.save("", "x")
            fail("accepted a blank path")
        } catch (_: IllegalArgumentException) {
            // expected
        }
        try {
            drafts.save("huge.txt", "a".repeat(Drafts.MAX_BYTES + 1))
            fail("accepted an oversized draft")
        } catch (_: IllegalArgumentException) {
            // expected
        }
    }

    @Test
    fun `the eol is normalised and corrupt files are ignored`() {
        drafts.save("a.txt", "a", eol = "\r")
        assertEquals("\n", drafts.read("a.txt")?.eol)

        val file = File(File(root, "drafts/default"), FileHash.sha256("a.txt") + ".json")
        file.writeText("{broken")
        assertNull(drafts.read("a.txt"))
        assertTrue(drafts.list().isEmpty())
    }
}
