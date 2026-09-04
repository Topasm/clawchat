package com.clawchat.android.core.ui.update

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.R
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawListSection
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.update.UpdateFailure
import com.clawchat.android.core.update.UpdatePhase
import com.clawchat.android.core.update.UpdateState
import java.util.Locale

/**
 * Launch-time prompt for a newly published release. It stays out of the way
 * until the user acts: download, skip this version, or dismiss for now.
 */
@Composable
fun AppUpdatePrompt(
    state: UpdateState,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
    onSkip: () -> Unit,
    onDismiss: () -> Unit,
) {
    val update = state.update
    if (!state.promptVisible || update == null) return

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                stringResource(R.string.update_available_title),
                fontWeight = FontWeight.SemiBold,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    stringResource(
                        R.string.update_available_message,
                        update.version,
                        state.currentVersion,
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (update.releaseNotes.isNotBlank()) {
                    Text(
                        update.releaseNotes,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .heightIn(max = 220.dp)
                            .verticalScroll(rememberScrollState()),
                    )
                }
                UpdateProgress(state)
                state.failure?.let {
                    Text(
                        updateFailureMessage(it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                if (state.needsInstallPermission) {
                    Text(
                        stringResource(R.string.update_install_permission),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        confirmButton = {
            when (state.phase) {
                UpdatePhase.ReadyToInstall -> Button(onClick = onInstall) {
                    Text(stringResource(R.string.update_install_action))
                }
                UpdatePhase.Downloading -> TextButton(onClick = {}, enabled = false) {
                    Text(stringResource(R.string.update_downloading_action))
                }
                else -> Button(onClick = onDownload) {
                    Text(stringResource(R.string.update_download_action))
                }
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (state.phase != UpdatePhase.Downloading) {
                    TextButton(onClick = onSkip) { Text(stringResource(R.string.update_skip_action)) }
                }
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.update_later_action)) }
            }
        },
    )
}

/** Settings section: current version, manual check, download, and install. */
@Composable
fun AppUpdateSection(
    state: UpdateState,
    onCheck: () -> Unit,
    onDownload: () -> Unit,
    onInstall: () -> Unit,
    onToggleAutoCheck: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    ClawListSection(
        modifier = modifier,
        header = {
            ClawSectionHeader(
                title = stringResource(R.string.update_section_title),
                subtitle = stringResource(R.string.update_section_subtitle),
            )
        },
    ) {
        ClawListItemSurface {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    stringResource(R.string.update_version_label),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    state.currentVersion,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                )
            }
            Text(
                text = updateStatusLine(state),
                style = MaterialTheme.typography.bodySmall,
                color = if (state.phase == UpdatePhase.Failed) {
                    MaterialTheme.colorScheme.error
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            UpdateProgress(state)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                TextButton(
                    onClick = onCheck,
                    enabled = state.supported &&
                        state.phase != UpdatePhase.Checking &&
                        state.phase != UpdatePhase.Downloading,
                ) {
                    Text(
                        stringResource(
                            if (state.phase == UpdatePhase.Checking) {
                                R.string.update_checking_action
                            } else {
                                R.string.update_check_now_action
                            },
                        ),
                    )
                }
                when (state.phase) {
                    UpdatePhase.Available -> Button(onClick = onDownload) {
                        Text(stringResource(R.string.update_download_action))
                    }
                    UpdatePhase.ReadyToInstall -> Button(onClick = onInstall) {
                        Text(stringResource(R.string.update_install_action))
                    }
                    else -> Unit
                }
            }
        }
        ClawListItemSurface {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        stringResource(R.string.update_auto_check_title),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        stringResource(R.string.update_auto_check_subtitle),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(
                    checked = state.autoCheckEnabled,
                    onCheckedChange = onToggleAutoCheck,
                    enabled = state.supported,
                )
            }
        }
    }
}

@Composable
private fun UpdateProgress(state: UpdateState) {
    if (state.phase != UpdatePhase.Downloading) return
    val progress = state.progress
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        if (progress != null) {
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        }
        Text(
            text = "${formatBytes(state.downloadedBytes)} / ${formatBytes(state.totalBytes)}",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
internal fun updateStatusLine(state: UpdateState): String = when {
    state.phase == UpdatePhase.Failed && state.failure != null ->
        updateFailureMessage(state.failure)
    !state.supported -> stringResource(R.string.update_status_manual)
    state.phase == UpdatePhase.Checking -> stringResource(R.string.update_status_checking)
    state.phase == UpdatePhase.Downloading -> stringResource(
        R.string.update_status_downloading,
        state.update?.version.orEmpty(),
    )
    state.phase == UpdatePhase.ReadyToInstall -> stringResource(
        R.string.update_status_ready,
        state.update?.version.orEmpty(),
    )
    state.phase == UpdatePhase.Available -> stringResource(
        R.string.update_status_available,
        state.update?.version.orEmpty(),
    )
    state.phase == UpdatePhase.Failed -> stringResource(R.string.update_status_failed)
    state.phase == UpdatePhase.UpToDate -> stringResource(R.string.update_status_current)
    else -> stringResource(R.string.update_status_delivery)
}

@Composable
internal fun updateFailureMessage(failure: UpdateFailure): String {
    val message = failure.messageResource()
    return stringResource(message.resource, *message.arguments.toTypedArray())
}

internal data class UpdateFailureMessageResource(
    val resource: Int,
    val arguments: List<Any> = emptyList(),
)

/** Pure mapping keeps local categories testable and independent of translated text. */
internal fun UpdateFailure.messageResource(): UpdateFailureMessageResource = when (this) {
    UpdateFailure.UnsupportedBuild ->
        UpdateFailureMessageResource(R.string.update_error_unsupported_build)
    is UpdateFailure.CheckFailed -> detail?.let {
        UpdateFailureMessageResource(R.string.update_error_check_detail, listOf(it))
    } ?: UpdateFailureMessageResource(R.string.update_error_check)
    UpdateFailure.CheckNetworkFailed ->
        UpdateFailureMessageResource(R.string.update_error_check_network)
    is UpdateFailure.CheckHttpError -> detail?.let {
        UpdateFailureMessageResource(
            R.string.update_error_check_http_detail,
            listOf(statusCode, it),
        )
    } ?: UpdateFailureMessageResource(R.string.update_error_check_http, listOf(statusCode))
    UpdateFailure.CacheUnavailable ->
        UpdateFailureMessageResource(R.string.update_error_cache_unavailable)
    is UpdateFailure.DownloadHttpError ->
        UpdateFailureMessageResource(R.string.update_error_download_http, listOf(statusCode))
    is UpdateFailure.ChecksumHttpError ->
        UpdateFailureMessageResource(R.string.update_error_checksum_http, listOf(statusCode))
    UpdateFailure.InvalidChecksumPayload ->
        UpdateFailureMessageResource(R.string.update_error_checksum_invalid)
    UpdateFailure.ChecksumMismatch ->
        UpdateFailureMessageResource(R.string.update_error_checksum_mismatch)
    is UpdateFailure.DownloadFailed -> detail?.let {
        UpdateFailureMessageResource(R.string.update_error_download_detail, listOf(it))
    } ?: UpdateFailureMessageResource(R.string.update_error_download)
    is UpdateFailure.InstallPermissionFailed -> detail?.let {
        UpdateFailureMessageResource(R.string.update_error_install_permission_detail, listOf(it))
    } ?: UpdateFailureMessageResource(R.string.update_error_install_permission)
    is UpdateFailure.InstallLaunchFailed -> detail?.let {
        UpdateFailureMessageResource(R.string.update_error_install_launch_detail, listOf(it))
    } ?: UpdateFailureMessageResource(R.string.update_error_install_launch)
}

internal fun formatBytes(bytes: Long): String = when {
    bytes <= 0 -> "—"
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(Locale.US, "%.0f KB", bytes / 1024.0)
    else -> String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0))
}
