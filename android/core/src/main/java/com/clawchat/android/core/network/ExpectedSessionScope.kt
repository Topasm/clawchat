package com.clawchat.android.core.network

import com.clawchat.android.core.data.ActiveSession
import java.io.IOException

/**
 * Internal OkHttp request tag that pins durable background work to the
 * workspace that owns it. It is never serialized as an HTTP header.
 */
data class ExpectedSessionScope(val value: String)

/** Retryable signal raised before a request can cross a workspace boundary. */
class SessionScopeChangedException(
    expected: String,
    actual: String?,
) : IOException(
    "Active ClawChat workspace changed (expected=$expected, actual=${actual ?: "none"})",
)

/** Authenticated API work is invalid while this device is the active workspace. */
class NoActiveServerException : IOException(
    "No ClawChat server workspace is active",
)

/** Stable identity used to keep one request inside the server that created it. */
internal fun ActiveSession.networkScope(): String? = when (authMode) {
    "paired" -> hostId?.trim()?.takeIf(String::isNotEmpty)
    "manual" -> apiBaseUrl?.trim()?.trimEnd('/')?.takeIf(String::isNotEmpty)
    else -> hostId?.trim()?.takeIf(String::isNotEmpty)
        ?: apiBaseUrl?.trim()?.trimEnd('/')?.takeIf(String::isNotEmpty)
}
