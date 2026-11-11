package dev.leocode.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChildEnvTest {

    @Test
    fun `only allowlisted keys survive`() {
        val env = ChildEnv.build(
            mapOf(
                "HOME" to "/home/user",
                "PATH" to "/bin",
                "SECRET_TOKEN" to "nope",
                "LD_PRELOAD" to "/tmp/evil.so"
            )
        )

        assertEquals(setOf("HOME", "PATH"), env.keys)
        assertEquals("/home/user", env["HOME"])
        assertFalse(env.containsKey("SECRET_TOKEN"))
        assertFalse(env.containsKey("LD_PRELOAD"))
    }

    @Test
    fun `extra overrides base and is filtered the same way`() {
        val env = ChildEnv.build(
            mapOf("HOME" to "/old", "LANG" to "C"),
            mapOf("HOME" to "/new", "COLUMNS" to "120", "AWS_SECRET_ACCESS_KEY" to "nope")
        )

        assertEquals("/new", env["HOME"])
        assertEquals("C", env["LANG"])
        assertEquals("120", env["COLUMNS"])
        assertFalse(env.containsKey("AWS_SECRET_ACCESS_KEY"))
    }

    @Test
    fun `unknown keys are dropped from both maps`() {
        val env = ChildEnv.build(
            mapOf("TERM" to "xterm", "ANDROID_DATA" to "/data"),
            mapOf("RANDOM" to "value")
        )

        assertEquals(mapOf("TERM" to "xterm"), env)
    }
}
