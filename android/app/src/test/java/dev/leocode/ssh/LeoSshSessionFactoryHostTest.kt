package dev.leocode.ssh

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Task 23: JGit reports the connect address as `[host]:port`, so the factory
 * must hand `known_hosts` and the prompt UI the bare host name. A regression
 * here writes `[[host]:port]:port`, which is not valid OpenSSH and is never
 * matched again — the host is re-prompted on every connection.
 */
class LeoSshSessionFactoryHostTest {

    @Test
    fun `strips brackets and port from a bracketed host`() {
        assertEquals("10.0.0.5", LeoSshSessionFactory.normalizeHost("[10.0.0.5]:2222"))
    }

    @Test
    fun `strips brackets without a port`() {
        assertEquals("github.com", LeoSshSessionFactory.normalizeHost("[github.com]"))
    }

    @Test
    fun `keeps a bare host name unchanged`() {
        assertEquals("github.com", LeoSshSessionFactory.normalizeHost("github.com"))
    }

    @Test
    fun `keeps a bare IPv6 literal and only drops the port`() {
        assertEquals("::1", LeoSshSessionFactory.normalizeHost("::1"))
    }

    @Test
    fun `keeps an IPv6 literal inside brackets`() {
        assertEquals("2001:db8::1", LeoSshSessionFactory.normalizeHost("[2001:db8::1]:22"))
    }

    @Test
    fun `trims surrounding whitespace`() {
        assertEquals("example.com", LeoSshSessionFactory.normalizeHost("  [example.com]:22  "))
    }
}
