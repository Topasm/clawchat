package com.clawchat.android.core.update

import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class AppUpdateRepositoryTest {

    private val api = mockk<GithubReleaseApi>()

    @Test
    fun `invalid updater configuration returns a typed local failure`() = runTest {
        val repository = AppUpdateRepositoryImpl(
            api,
            UpdateConfig(repository = "", currentVersion = "1.4.5", enabled = true),
        )

        assertEquals(
            UpdateCheckResult.Failure(UpdateFailure.UnsupportedBuild),
            repository.findUpdate(),
        )
        coVerify(exactly = 0) { api.listReleases(any(), any(), any()) }
    }

    @Test
    fun `network failure is categorized without leaking a local English message`() = runTest {
        coEvery { api.listReleases(any(), any(), any()) } throws
            IOException("connection reset\nwhile reading releases")
        val repository = AppUpdateRepositoryImpl(
            api,
            UpdateConfig(
                repository = "Topasm/clawchat",
                currentVersion = "1.4.5",
                enabled = true,
            ),
        )

        assertEquals(
            UpdateCheckResult.Failure(UpdateFailure.CheckNetworkFailed),
            repository.findUpdate(),
        )
    }

    @Test
    fun `http failure preserves only a bounded server message`() = runTest {
        val response = Response.error<List<GithubRelease>>(
            403,
            """{"message":"API rate limit exceeded\nfor this address"}"""
                .toResponseBody("application/json".toMediaType()),
        )
        coEvery { api.listReleases(any(), any(), any()) } throws HttpException(response)
        val repository = AppUpdateRepositoryImpl(
            api,
            UpdateConfig(
                repository = "Topasm/clawchat",
                currentVersion = "1.4.5",
                enabled = true,
            ),
        )

        assertEquals(
            UpdateCheckResult.Failure(
                UpdateFailure.CheckHttpError(
                    statusCode = 403,
                    detail = "API rate limit exceeded for this address",
                ),
            ),
            repository.findUpdate(),
        )
    }
}
