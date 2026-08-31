package com.clawchat.android.core.network

import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RelayClientSessionTest {

    @Test
    fun `local or unconfigured mode cannot reuse remembered relay fields`() = runTest {
        val sessionStore = mockk<SessionStore>()
        // Raw saved relay flows are deliberately not stubbed. RelayClient must
        // only consume the atomic active-session view, which is null locally.
        every { sessionStore.activeSession } returns flowOf(null)

        assertFalse(RelayClient(sessionStore).ensureConnected())
    }

    @Test
    fun `manual session cannot inherit paired relay configuration`() = runTest {
        val sessionStore = sessionStore(
            activeSession(
                authMode = "manual",
                relayUrl = "https://relay.example",
                hostPublicKey = "stale-public-key",
            ),
        )

        assertFalse(RelayClient(sessionStore).ensureConnected())
    }

    @Test
    fun `workspace-owned relay request fails before crossing into another host`() = runTest {
        val sessionStore = sessionStore(activeSession(hostId = "host-b"))
        val request = Request.Builder()
            .url("https://host-a.example/api/todos")
            .tag(
                AuthenticatedRoute::class.java,
                AuthenticatedRoute(
                    baseUrl = "https://host-a.example/".toHttpUrl(),
                    token = "token-a",
                    workspaceScope = "host-a",
                ),
            )
            .build()

        val failure = runCatching { RelayClient(sessionStore).execute(request) }.exceptionOrNull()

        assertTrue(failure is SessionScopeChangedException)
    }

    @Test
    fun `relay config is derived from one paired session snapshot`() {
        val config = activeSession(
            hostId = " host-a ",
            relayUrl = "https://relay.example/",
            hostPublicKey = " public-key ",
        ).relayConnectionConfigOrNull()

        assertEquals(
            RelayConnectionConfig(
                relayUrl = "https://relay.example",
                hostId = "host-a",
                hostPublicKey = "public-key",
            ),
            config,
        )
    }

    private fun sessionStore(session: ActiveSession): SessionStore = mockk<SessionStore>().also {
        every { it.activeSession } returns flowOf(session)
    }

    private fun activeSession(
        hostId: String = "host-a",
        authMode: String = "paired",
        relayUrl: String = "https://relay.example",
        hostPublicKey: String = "public-key",
    ) = ActiveSession(
        token = "token-$hostId",
        apiBaseUrl = "https://$hostId.example",
        hostId = hostId,
        authMode = authMode,
        relayUrl = relayUrl,
        hostPublicKey = hostPublicKey,
    )
}
