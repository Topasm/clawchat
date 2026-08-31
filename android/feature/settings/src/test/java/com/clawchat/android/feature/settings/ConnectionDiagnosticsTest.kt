package com.clawchat.android.feature.settings

import com.clawchat.android.core.data.model.HealthResponse
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionDiagnosticsTest {

    @Test
    fun `safe server origin removes credentials path query and fragment`() {
        assertEquals(
            "https://example.com:8443",
            safeServerOrigin("https://user:password@example.com:8443/private?token=secret#fragment"),
        )
    }

    @Test
    fun `invalid address is hidden`() {
        assertEquals("Configured (address hidden)", safeServerOrigin("not a server URL/private"))
    }

    @Test
    fun `safe report excludes server secrets`() {
        val diagnostics = buildConnectionDiagnostics(
            apiBaseUrl = "https://example.com/private?token=server-secret",
            relayConfigured = true,
            authMode = "paired",
            hasSession = true,
            health = HealthResponse(
                status = "ok",
                version = "1.4.5",
                aiProvider = "none",
                aiModel = "none",
                aiConnected = false,
            ),
            latencyMillis = 42,
            realtimeConnected = false,
            lastRealtimeEventAtEpochMillis = null,
            realtimeError = "Bearer ws-secret disconnected",
            httpError = null,
            checkedAtEpochMillis = 1_700_000_000_000L,
        )

        val report = diagnostics.toSafeReport()

        assertTrue(report.contains("https://example.com"))
        assertTrue(report.contains("Bearer <redacted>"))
        assertFalse(report.contains("private"))
        assertFalse(report.contains("server-secret"))
        assertFalse(report.contains("ws-secret"))
    }

    @Test
    fun `error sanitizer redacts query credentials`() {
        val sanitized = sanitizeDiagnosticError(
            "failed at https://example.com/private?token=hidden " +
                "token=abc refresh_token=def pin=1234 api_key=ghi",
        )

        assertEquals(
            "failed at https://example.com token=<redacted> refresh_token=<redacted> " +
                "pin=<redacted> api_key=<redacted>",
            sanitized,
        )
    }

    @Test
    fun `error sanitizer redacts json credentials and authorization schemes`() {
        val sanitized = sanitizeDiagnosticError(
            "Authorization: Basic dXNlcjpwYXNz {\"access_token\":\"abc\", password='secret'}",
        )

        assertFalse(sanitized!!.contains("dXNlcjpwYXNz"))
        assertFalse(sanitized.contains("abc"))
        assertFalse(sanitized.contains("'secret'"))
        assertTrue(sanitized.contains("Basic <redacted>"))
        assertTrue(sanitized.contains("<redacted>"))
    }
}
