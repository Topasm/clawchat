package com.clawchat.android.core.network

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
