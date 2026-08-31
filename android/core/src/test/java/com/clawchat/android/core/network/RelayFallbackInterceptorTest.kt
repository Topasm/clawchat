package com.clawchat.android.core.network

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import okhttp3.Interceptor
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class RelayFallbackInterceptorTest {
    private val relayClient = mockk<RelayClient>()
    private val chain = mockk<Interceptor.Chain>()
    private val interceptor = RelayFallbackInterceptor(relayClient)

    @Test
    fun `direct-only request never serializes into the relay`() {
        val incoming = request()
            .newBuilder()
            .header(DIRECT_ONLY_HEADER, "true")
            .build()
        every { chain.request() } returns incoming
        every { chain.proceed(any()) } throws IOException("direct offline")

        val error = runCatching { interceptor.intercept(chain) }.exceptionOrNull()

        assertTrue(error is DirectConnectionRequiredException)
        coVerify(exactly = 0) { relayClient.execute(any()) }
        io.mockk.verify {
            chain.proceed(match { it.header(DIRECT_ONLY_HEADER) == null })
        }
    }

    @Test
    fun `relay fallback keeps the expected workspace request tag`() {
        val relayedRequest = slot<Request>()
        val incoming = request()
        every { chain.request() } returns incoming
        every { chain.proceed(any()) } throws IOException("direct offline")
        coEvery { relayClient.execute(capture(relayedRequest)) } answers {
            Response.Builder()
                .request(firstArg())
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("Relay")
                .build()
        }

        interceptor.intercept(chain).close()

        assertEquals(
            ExpectedSessionScope("host-a"),
            relayedRequest.captured.tag(ExpectedSessionScope::class.java),
        )
        assertNull(relayedRequest.captured.header(DIRECT_ONLY_HEADER))
    }

    private fun request(): Request = Request.Builder()
        .url("https://host-a.example/api/attachments")
        .tag(ExpectedSessionScope::class.java, ExpectedSessionScope("host-a"))
        .build()
}
