package com.clawchat.android.core.ui.update

import com.clawchat.android.core.R
import com.clawchat.android.core.update.UpdateFailure
import org.junit.Assert.assertEquals
import org.junit.Test

class UpdateFailureMessageTest {

    @Test
    fun `every local updater category maps to a stable resource`() {
        val mappings = mapOf(
            UpdateFailure.UnsupportedBuild to R.string.update_error_unsupported_build,
            UpdateFailure.CheckFailed() to R.string.update_error_check,
            UpdateFailure.CheckNetworkFailed to R.string.update_error_check_network,
            UpdateFailure.CheckHttpError(429) to R.string.update_error_check_http,
            UpdateFailure.CacheUnavailable to R.string.update_error_cache_unavailable,
            UpdateFailure.DownloadHttpError(503) to R.string.update_error_download_http,
            UpdateFailure.ChecksumHttpError(502) to R.string.update_error_checksum_http,
            UpdateFailure.InvalidChecksumPayload to R.string.update_error_checksum_invalid,
            UpdateFailure.ChecksumMismatch to R.string.update_error_checksum_mismatch,
            UpdateFailure.DownloadFailed() to R.string.update_error_download,
            UpdateFailure.InstallPermissionFailed() to R.string.update_error_install_permission,
            UpdateFailure.InstallLaunchFailed() to R.string.update_error_install_launch,
        )

        mappings.forEach { (failure, expectedResource) ->
            assertEquals(expectedResource, failure.messageResource().resource)
        }
    }

    @Test
    fun `remote detail remains an argument instead of becoming a translation key`() {
        assertEquals(
            UpdateFailureMessageResource(
                R.string.update_error_check_detail,
                listOf("HTTP 503"),
            ),
            UpdateFailure.CheckFailed("HTTP 503").messageResource(),
        )
        assertEquals(
            UpdateFailureMessageResource(
                R.string.update_error_download_detail,
                listOf("socket closed"),
            ),
            UpdateFailure.DownloadFailed("socket closed").messageResource(),
        )
        assertEquals(
            UpdateFailureMessageResource(
                R.string.update_error_check_http_detail,
                listOf(403, "API rate limit exceeded"),
            ),
            UpdateFailure.CheckHttpError(
                403,
                "API rate limit exceeded",
            ).messageResource(),
        )
    }
}
