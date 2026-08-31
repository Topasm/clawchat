package com.clawchat.android.core.network

import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatStreamerTest {

    private fun streamer(baseUrl: String?, token: String?): ChatStreamerImpl {
        val sessionStore = mockk<SessionStore>()
        every { sessionStore.activeSession } returns flowOf(
            if (baseUrl == null && token == null) {
                null
            } else {
                ActiveSession(
                    token = token.orEmpty(),
                    apiBaseUrl = baseUrl,
                    hostId = null,
                    authMode = "manual",
                )
            },
        )
        return ChatStreamerImpl(OkHttpClient(), sessionStore)
    }

    @Test
    fun `a missing server address reports an error rather than streaming nothing`() = runTest {
        val events = streamer(baseUrl = null, token = "t").stream("c1", "hi").toList()

        assertEquals(listOf(SseEvent.Error("Not connected to a server")), events)
    }

    @Test
    fun `a missing token reports the same error`() = runTest {
        val events = streamer(baseUrl = "http://localhost:8000", token = null)
            .stream("c1", "hi")
            .toList()

        assertEquals(listOf(SseEvent.Error("Not connected to a server")), events)
    }

    @Test
    fun `a blank session value counts as missing`() = runTest {
        val events = streamer(baseUrl = "  ", token = "  ").stream("c1", "hi").toList()

        assertEquals(listOf(SseEvent.Error("Not connected to a server")), events)
    }

    @Test
    fun `local mode cannot stream through remembered credentials`() = runTest {
        val sessionStore = mockk<SessionStore>()
        // A local workspace exposes no active session. Raw saved-token flows are
        // intentionally not stubbed: touching either would fail this test.
        every { sessionStore.activeSession } returns flowOf(null)
        val streamer = ChatStreamerImpl(OkHttpClient(), sessionStore)

        val events = streamer.stream("c1", "hi").toList()

        assertEquals(listOf(SseEvent.Error("Not connected to a server")), events)
    }
}
