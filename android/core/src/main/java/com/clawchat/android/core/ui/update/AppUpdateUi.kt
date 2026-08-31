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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawListSection
import com.clawchat.android.core.ui.ClawSectionHeader
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
                "Update available",
                fontWeight = FontWeight.SemiBold,
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "ClawChat ${update.version} is available. You have ${state.currentVersion}.",
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
                state.error?.let {
                    Text(
                        it,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
                if (state.needsInstallPermission) {
                    Text(
                        "Android needs permission to install apps from ClawChat. " +
                            "Grant it on the screen that opens, then tap Install again.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        confirmButton = {
            when (state.phase) {
                UpdatePhase.ReadyToInstall -> Button(onClick = onInstall) { Text("Install") }
                UpdatePhase.Downloading -> TextButton(onClick = {}, enabled = false) {
                    Text("Downloading…")
                }
                else -> Button(onClick = onDownload) { Text("Download") }
            }
        },
        dismissButton = {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                if (state.phase != UpdatePhase.Downloading) {
                    TextButton(onClick = onSkip) { Text("Skip") }
                }
                TextButton(onClick = onDismiss) { Text("Later") }
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
                title = "App updates",
                subtitle = "Installed from GitHub releases.",
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
                    "Version",
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
                    Text(if (state.phase == UpdatePhase.Checking) "Checking…" else "Check now")
                }
                when (state.phase) {
                    UpdatePhase.Available -> Button(onClick = onDownload) { Text("Download") }
                    UpdatePhase.ReadyToInstall -> Button(onClick = onInstall) { Text("Install") }
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
                        "Check automatically",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        "Looks for a new release at most twice a day.",
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

internal fun updateStatusLine(state: UpdateState): String = when {
    !state.supported -> "This build installs updates manually."
    state.phase == UpdatePhase.Checking -> "Checking for updates…"
    state.phase == UpdatePhase.Downloading -> "Downloading ${state.update?.version.orEmpty()}…"
    state.phase == UpdatePhase.ReadyToInstall ->
        "ClawChat ${state.update?.version.orEmpty()} is ready to install."
    state.phase == UpdatePhase.Available -> "ClawChat ${state.update?.version.orEmpty()} is available."
    state.phase == UpdatePhase.Failed -> state.error ?: "Update check failed."
    state.phase == UpdatePhase.UpToDate -> "ClawChat is up to date."
    else -> "Updates are delivered through GitHub releases."
}

internal fun formatBytes(bytes: Long): String = when {
    bytes <= 0 -> "—"
    bytes < 1024 -> "$bytes B"
    bytes < 1024 * 1024 -> String.format(Locale.US, "%.0f KB", bytes / 1024.0)
    else -> String.format(Locale.US, "%.1f MB", bytes / (1024.0 * 1024.0))
}
