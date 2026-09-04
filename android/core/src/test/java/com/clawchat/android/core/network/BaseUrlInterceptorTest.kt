package com.clawchat.android.core.network

import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class BaseUrlInterceptorTest {

    @Test
    fun `authenticated request fails closed until a server is active`() {
        val configuredServer = MockWebServer()
        configuredServer.start()
        try {
            configuredServer.enqueue(MockResponse().setBody("configured"))

            val activeSession = MutableStateFlow<ActiveSession?>(null)
            val sessionStore = mockk<SessionStore>()
            every { sessionStore.activeSession } returns activeSession
            val client = OkHttpClient.Builder()
                .addInterceptor(BaseUrlInterceptor(sessionStore))
                .build()
            val request = Request.Builder()
                .url("http://127.0.0.1:8000/api/health")
                .build()

            assertThrows(NoActiveServerException::class.java) {
                client.newCall(request).execute()
            }

            activeSession.value = session(configuredServer.url("/").toString(), "token")
            client.newCall(request).execute().use { response ->
                assertEquals("configured", response.body.string())
            }
            assertEquals("/api/health", configuredServer.takeRequest().requestUrl?.encodedPath)
        } finally {
            configuredServer.shutdown()
        }
    }

    @Test
    fun `requests follow the active server after a session change`() {
        val firstServer = MockWebServer()
        val secondServer = MockWebServer()
        firstServer.start()
        secondServer.start()
        try {
            firstServer.enqueue(MockResponse().setBody("first"))
            secondServer.enqueue(MockResponse().setBody("second"))

            val activeSession = MutableStateFlow<ActiveSession?>(
                session(firstServer.url("/").toString(), "token-first"),
            )
            val sessionStore = mockk<SessionStore>()
            every { sessionStore.activeSession } returns activeSession
            val client = OkHttpClient.Builder()
                .addInterceptor(BaseUrlInterceptor(sessionStore))
                .build()
            val placeholderRequest = Request.Builder()
                .url("http://127.0.0.1/api/health")
                .build()

            client.newCall(placeholderRequest).execute().use { response ->
                assertEquals("first", response.body.string())
            }
            assertEquals("/api/health", firstServer.takeRequest().requestUrl?.encodedPath)

            activeSession.value = session(secondServer.url("/").toString(), "token-second")
            client.newCall(placeholderRequest).execute().use { response ->
                assertEquals("second", response.body.string())
            }
            assertEquals("/api/health", secondServer.takeRequest().requestUrl?.encodedPath)
        } finally {
            firstServer.shutdown()
            secondServer.shutdown()
        }
    }

    @Test
    fun `workspace-owned request fails closed after a workspace change`() {
        val activeSession = MutableStateFlow<ActiveSession?>(
            session("https://workspace-b.example/", "token-b", hostId = "host-b"),
        )
        val sessionStore = mockk<SessionStore>()
        every { sessionStore.activeSession } returns activeSession
        val client = OkHttpClient.Builder()
            .addInterceptor(BaseUrlInterceptor(sessionStore))
            .build()
        val request = Request.Builder()
            .url("http://127.0.0.1/api/todos")
            .tag(ExpectedSessionScope::class.java, ExpectedSessionScope("host-a"))
            .build()

        assertThrows(SessionScopeChangedException::class.java) {
            client.newCall(request).execute()
        }
    }

    @Test
    fun `workspace-owned request fails closed without an active session`() {
        val activeSession = MutableStateFlow<ActiveSession?>(null)
        val sessionStore = mockk<SessionStore>()
        every { sessionStore.activeSession } returns activeSession
        val client = OkHttpClient.Builder()
            .addInterceptor(BaseUrlInterceptor(sessionStore))
            .build()
        val request = Request.Builder()
            .url("http://127.0.0.1/api/todos")
            .tag(ExpectedSessionScope::class.java, ExpectedSessionScope("host-a"))
            .build()

        assertThrows(SessionScopeChangedException::class.java) {
            client.newCall(request).execute()
        }
    }

    @Test
    fun `workspace-owned request routes when its scope is still active`() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setBody("active"))
            val activeSession = MutableStateFlow<ActiveSession?>(
                session(server.url("/").toString(), "token-a", hostId = "host-a"),
            )
            val sessionStore = mockk<SessionStore>()
            every { sessionStore.activeSession } returns activeSession
            val client = OkHttpClient.Builder()
                .addInterceptor(BaseUrlInterceptor(sessionStore))
                .build()
            val request = Request.Builder()
                .url("http://127.0.0.1/api/todos")
                .tag(ExpectedSessionScope::class.java, ExpectedSessionScope("host-a"))
                .build()

            client.newCall(request).execute().use { response ->
                assertEquals("active", response.body.string())
            }
            assertEquals("/api/todos", server.takeRequest().requestUrl?.encodedPath)
        } finally {
            server.shutdown()
        }
    }

    private fun session(
        baseUrl: String,
        token: String,
        hostId: String? = null,
    ) = ActiveSession(
        token = token,
        apiBaseUrl = baseUrl,
        hostId = hostId,
        authMode = "paired",
    )
}
