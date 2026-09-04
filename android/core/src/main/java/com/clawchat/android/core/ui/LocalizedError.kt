package com.clawchat.android.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.clawchat.android.core.R

/**
 * Localizes errors synthesized by the Android client while preserving
 * server-provided messages verbatim. The prefixes mirror the network layer's
 * stable local fallbacks; remote validation details must not be guessed or rewritten.
 */
@Composable
fun localizedErrorMessage(message: String): String {
    val normalized = message.trim()
    return when {
        normalized.startsWith("Network error", ignoreCase = true) ||
            normalized.equals("Connection refused", ignoreCase = true) ||
            normalized.equals("offline", ignoreCase = true) ->
            stringResource(R.string.error_network_unavailable)

        normalized.startsWith("HTTP ", ignoreCase = true) ->
            stringResource(R.string.error_request_failed)

        normalized.equals("Unknown error", ignoreCase = true) ||
            normalized.startsWith("Unknown error:", ignoreCase = true) ->
            stringResource(R.string.error_unknown)

        normalized.equals(
            "Choose a local workspace or connect a server first",
            ignoreCase = true,
        ) -> stringResource(R.string.error_workspace_unconfigured)

        normalized.equals(
            "The active workspace changed before the operation could be saved",
            ignoreCase = true,
        ) -> stringResource(R.string.error_workspace_changed)

        normalized.equals("Projects require a server", ignoreCase = true) ||
            normalized.equals("AI organization requires a server", ignoreCase = true) ||
            normalized.equals("AI briefing requires a server", ignoreCase = true) ||
            normalized.equals("Recurring events require a server", ignoreCase = true) ->
            stringResource(R.string.error_server_feature_required)

        normalized.equals("Local task not found", ignoreCase = true) ->
            stringResource(R.string.error_local_task_not_found)

        normalized.startsWith("Invalid local task", ignoreCase = true) ||
            normalized.startsWith("Invalid due_before", ignoreCase = true) ->
            stringResource(R.string.error_invalid_local_task)

        normalized.equals("Local event not found", ignoreCase = true) ->
            stringResource(R.string.error_local_event_not_found)

        normalized.startsWith("Invalid local event", ignoreCase = true) ->
            stringResource(R.string.error_invalid_local_event)

        normalized.equals("Realtime connection closed", ignoreCase = true) ->
            stringResource(R.string.error_realtime_closed)

        else -> message
    }
}
