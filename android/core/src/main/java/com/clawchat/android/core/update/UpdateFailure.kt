package com.clawchat.android.core.update

/**
 * Stable updater failures that the UI can localize without inspecting an
 * exception message. Optional details come from remote or platform failures
 * and are sanitized before entering observable state.
 */
sealed interface UpdateFailure {
    data object UnsupportedBuild : UpdateFailure

    data class CheckFailed(val detail: String? = null) : UpdateFailure

    data object CheckNetworkFailed : UpdateFailure

    data class CheckHttpError(
        val statusCode: Int,
        val detail: String? = null,
    ) : UpdateFailure

    data object CacheUnavailable : UpdateFailure

    data class DownloadHttpError(val statusCode: Int) : UpdateFailure

    data class ChecksumHttpError(val statusCode: Int) : UpdateFailure

    data object InvalidChecksumPayload : UpdateFailure

    data object ChecksumMismatch : UpdateFailure

    data class DownloadFailed(val detail: String? = null) : UpdateFailure

    data class InstallPermissionFailed(val detail: String? = null) : UpdateFailure

    data class InstallLaunchFailed(val detail: String? = null) : UpdateFailure
}

/** Keeps dynamic error details useful but bounded and single-line for UI. */
internal fun safeUpdateFailureDetail(message: String?): String? = message
    ?.lineSequence()
    ?.joinToString(" ") { it.trim() }
    ?.trim()
    ?.takeIf(String::isNotEmpty)
    ?.take(MAX_UPDATE_FAILURE_DETAIL_LENGTH)

private const val MAX_UPDATE_FAILURE_DETAIL_LENGTH = 240
