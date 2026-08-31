package com.clawchat.android.core.network

import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.SessionStore
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthInterceptorTest {

    @Test
    fun `routing and authorization use one session snapshot`() {
        val firstServer = MockWebServer()
        val secondServer = MockWebServer()
        firstServer.start()
        secondServer.start()
        try {
            firstServer.enqueue(MockResponse().setBody("ok"))
            val firstSession = session(firstServer, "token-first")
            val secondSession = session(secondServer, "token-second")
            val activeSession = MutableStateFlow<ActiveSession?>(firstSession)
            val sessionStore = mockk<SessionStore>()
            every { sessionStore.activeSession } returns activeSession
            val client = OkHttpClient.Builder()
                .addInterceptor(BaseUrlInterceptor(sessionStore))
                .addInterceptor { chain ->
                    activeSession.value = secondSession
                    chain.proceed(chain.request())
                }
                .addInterceptor(AuthInterceptor(sessionStore, mockk(relaxed = true)))
                .build()

            client.newCall(
                Request.Builder().url("http://127.0.0.1/api/todos").build(),
            ).execute().close()

            assertEquals("Bearer token-first", firstServer.takeRequest().getHeader("Authorization"))
            assertEquals(0, secondServer.requestCount)
        } finally {
            firstServer.shutdown()
            secondServer.shutdown()
        }
    }

    @Test
    fun `workspace switch never replays an old request with the new token`() {
        val firstServer = MockWebServer()
        val secondServer = MockWebServer()
        firstServer.start()
        secondServer.start()
        try {
            firstServer.enqueue(MockResponse().setResponseCode(401))

            val firstSession = session(firstServer, "token-first")
            val secondSession = session(secondServer, "token-second")
            val activeSession = MutableStateFlow<ActiveSession?>(firstSession)
            val sessionStore = mockk<SessionStore>(relaxed = true)
            every { sessionStore.activeSession } returns activeSession
            val sessionRefresher = mockk<SessionRefresher>()
            coEvery { sessionRefresher.refreshAfterUnauthorized("token-first") } coAnswers {
                activeSession.value = secondSession
                "token-second"
            }
            val client = OkHttpClient.Builder()
                .addInterceptor(BaseUrlInterceptor(sessionStore))
                .addInterceptor(AuthInterceptor(sessionStore, sessionRefresher))
                .build()

            val response = client.newCall(
                Request.Builder().url("http://127.0.0.1/api/todos").build(),
            ).execute()

            response.use { assertEquals(401, it.code) }
            assertEquals("Bearer token-first", firstServer.takeRequest().getHeader("Authorization"))
            assertEquals(0, secondServer.requestCount)
            coVerify(exactly = 0) { sessionStore.clearSessionIfToken(any()) }
        } finally {
            firstServer.shutdown()
            secondServer.shutdown()
        }
    }

    @Test
    fun `failed refresh only attempts to clear the rejected token`() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(401))
            val activeSession = MutableStateFlow<ActiveSession?>(
                session(server, "token-first"),
            )
            val sessionStore = mockk<SessionStore>(relaxed = true)
            every { sessionStore.activeSession } returns activeSession
            val sessionRefresher = mockk<SessionRefresher>()
            coEvery { sessionRefresher.refreshAfterUnauthorized("token-first") } returns null
            val client = OkHttpClient.Builder()
                .addInterceptor(BaseUrlInterceptor(sessionStore))
                .addInterceptor(AuthInterceptor(sessionStore, sessionRefresher))
                .build()

            client.newCall(
                Request.Builder().url("http://127.0.0.1/api/todos").build(),
            ).execute().use { response -> assertEquals(401, response.code) }

            coVerify(exactly = 1) { sessionStore.clearSessionIfToken("token-first") }
            coVerify(exactly = 0) { sessionStore.clearSession() }
        } finally {
            server.shutdown()
        }
    }

    private fun session(server: MockWebServer, token: String) = ActiveSession(
        token = token,
        apiBaseUrl = server.url("/").toString(),
        hostId = null,
        authMode = "paired",
    )
}
