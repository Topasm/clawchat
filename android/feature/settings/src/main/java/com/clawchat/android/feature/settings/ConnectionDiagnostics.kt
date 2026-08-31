package com.clawchat.android.feature.settings

import com.clawchat.android.core.data.model.HealthResponse
import java.net.URI
import java.time.Instant

/** A copy-safe snapshot of the mobile client's current server connection. */
data class ConnectionDiagnostics(
    val serverOrigin: String,
    val connectionMode: String,
    val authMode: String,
    val hasSession: Boolean,
    val httpReachable: Boolean,
    val latencyMillis: Long?,
    val serverStatus: String?,
    val serverVersion: String?,
    val realtimeConnected: Boolean,
    val lastRealtimeEventAtEpochMillis: Long?,
    val lastError: String?,
    val checkedAtEpochMillis: Long,
) {
    /** Plain text intended for bug reports. Tokens, paths, queries, and relay URLs are omitted. */
    fun toSafeReport(): String = buildString {
        appendLine("ClawChat Android connection diagnostics")
        appendLine("Server: $serverOrigin")
        appendLine("Mode: $connectionMode")
        appendLine("Authentication: $authMode (${if (hasSession) "session present" else "no session"})")
        appendLine(
            "HTTP: ${if (httpReachable) "reachable" else "unreachable"}" +
                latencyMillis?.let { " (${it}ms)" }.orEmpty(),
        )
        appendLine("Server status: ${serverStatus ?: "unknown"}")
        appendLine("Server version: ${serverVersion ?: "unknown"}")
        appendLine("Realtime: ${if (realtimeConnected) "connected" else "disconnected"}")
        appendLine(
            "Last realtime event: " +
                (lastRealtimeEventAtEpochMillis?.let { Instant.ofEpochMilli(it).toString() } ?: "none"),
        )
        appendLine("Last error: ${lastError ?: "none"}")
        append("Checked: ${Instant.ofEpochMilli(checkedAtEpochMillis)}")
    }
}

internal fun buildConnectionDiagnostics(
    apiBaseUrl: String?,
    relayConfigured: Boolean,
    authMode: String?,
    hasSession: Boolean,
    health: HealthResponse?,
    latencyMillis: Long?,
    realtimeConnected: Boolean,
    lastRealtimeEventAtEpochMillis: Long?,
    realtimeError: String?,
    httpError: String?,
    checkedAtEpochMillis: Long = System.currentTimeMillis(),
): ConnectionDiagnostics = ConnectionDiagnostics(
    serverOrigin = safeServerOrigin(apiBaseUrl),
    connectionMode = if (relayConfigured) "Direct with relay fallback" else "Direct",
    authMode = when (authMode) {
        "paired" -> "Paired device"
        "manual" -> "PIN session"
        null, "" -> "Not configured"
        else -> "Configured"
    },
    hasSession = hasSession,
    httpReachable = health != null,
    latencyMillis = latencyMillis,
    serverStatus = health?.status,
    serverVersion = health?.version,
    realtimeConnected = realtimeConnected,
    lastRealtimeEventAtEpochMillis = lastRealtimeEventAtEpochMillis,
    lastError = sanitizeDiagnosticError(httpError ?: realtimeError),
    checkedAtEpochMillis = checkedAtEpochMillis,
)

/** Keep only scheme, host, and explicit port; never copy credentials, path, query, or fragment. */
internal fun safeServerOrigin(rawUrl: String?): String {
    if (rawUrl.isNullOrBlank()) return "Not configured"
    return runCatching {
        val uri = URI(rawUrl.trim())
        require(uri.scheme.equals("http", ignoreCase = true) || uri.scheme.equals("https", ignoreCase = true))
        val rawHost = requireNotNull(uri.host)
        val host = if (rawHost.contains(':')) "[$rawHost]" else rawHost
        buildString {
            append(uri.scheme.lowercase())
            append("://")
            append(host)
            if (uri.port >= 0) append(":${uri.port}")
        }
    }.getOrElse { "Configured (address hidden)" }
}

/** Remove common credential shapes before an error reaches the UI or clipboard. */
internal fun sanitizeDiagnosticError(message: String?): String? {
    val value = message?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    return value
        .replace(Regex("(?i)https?://[^\\s,;]+")) { match -> safeServerOrigin(match.value) }
        .replace(Regex("(?i)\\bBearer\\s+[^\\s,;]+"), "Bearer <redacted>")
        .replace(Regex("(?i)\\bBasic\\s+[^\\s,;]+"), "Basic <redacted>")
        .replace(DIAGNOSTIC_CREDENTIAL_PATTERN) { match ->
            "${match.groupValues[1]}<redacted>"
        }
        .take(240)
}

private val DIAGNOSTIC_CREDENTIAL_PATTERN = Regex(
    "(?i)([\\\"']?(?:access_token|refresh_token|token|session|password|secret|api_key|key|pin|code)" +
        "[\\\"']?\\s*[:=]\\s*)[\\\"']?[^\\\"',&\\s}]+[\\\"']?",
)
