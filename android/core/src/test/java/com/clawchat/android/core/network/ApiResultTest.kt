package com.clawchat.android.core.network

import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.CancellationException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response

class ApiResultTest {

    @Test
    fun `structured server error keeps its recovery message and code`() = runTest {
        val response = Response.error<Unit>(
            409,
            """{"error":{"code":"AGENT_RUN_SUPERSEDED","message":"A newer run already exists"}}"""
                .toResponseBody("application/json".toMediaType()),
        )

        val result = apiCall<Unit> { throw HttpException(response) }

        assertEquals(
            ApiResult.Error(
                message = "A newer run already exists",
                code = 409,
                serverCode = "AGENT_RUN_SUPERSEDED",
            ),
            result,
        )
    }

    @Test
    fun `non-json response falls back to the HTTP exception message`() = runTest {
        val response = Response.error<Unit>(
            502,
            "bad gateway".toResponseBody("text/plain".toMediaType()),
        )

        val result = apiCall<Unit> { throw HttpException(response) }

        assertEquals(502, (result as ApiResult.Error).code)
        assertEquals(null, result.serverCode)
    }

    @Test
    fun `io failures keep a stable network error prefix for localization`() = runTest {
        val result = apiCall<Unit> { throw java.io.IOException("connection reset") }

        assertEquals("Network error: connection reset", (result as ApiResult.Error).message)
    }

    @Test
    fun `unexpected failures keep a stable unknown error prefix for localization`() = runTest {
        val result = apiCall<Unit> { throw IllegalStateException("bad response") }

        assertEquals("Unknown error: bad response", (result as ApiResult.Error).message)
    }

    @Test
    fun `coroutine cancellation is never converted into an API error`() = runTest {
        val cancellation = CancellationException("stopped")

        try {
            apiCall<Unit> { throw cancellation }
            fail("Expected cancellation to propagate")
        } catch (actual: CancellationException) {
            assertSame(cancellation, actual)
        }
    }
}
