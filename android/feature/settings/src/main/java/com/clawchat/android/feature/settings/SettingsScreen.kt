@file:OptIn(ExperimentalLayoutApi::class)

package com.clawchat.android.feature.settings

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.PairedDevice
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.ClawNavigationMenuButton
import com.clawchat.android.core.ui.localizedErrorMessage
import com.clawchat.android.core.ui.theme.AccentColor
import com.clawchat.android.core.ui.update.AppUpdateSection
import com.clawchat.android.core.ui.theme.ThemeMode
import com.clawchat.android.core.ui.icons.ClawIcons

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    onOpenNavigation: () -> Unit = {},
    onLoggedOut: () -> Unit = {},
    onSetupServer: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val updateState by viewModel.updateState.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current
    val diagnosticsCopiedMessage = stringResource(R.string.settings_diagnostics_copied)
    var showLocalModeConfirmation by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(R.string.settings_title),
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.titleLarge,
                    )
                },
                navigationIcon = {
                    ClawNavigationMenuButton(onClick = onOpenNavigation)
                },
                colors = ClawTopBarColors(),
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            item {
                WorkspaceModeSection(
                    state = state,
                    onConnectWorkspace = onSetupServer,
                    onActivateSavedServer = viewModel::activateSavedServer,
                    onSwitchToLocal = { showLocalModeConfirmation = true },
                )
            }

            item {
                SettingsSection(
                    title = stringResource(R.string.settings_appearance),
                    subtitle = stringResource(R.string.settings_appearance_description),
                ) {
                    ThemeModeCard(
                        selectedKey = state.themeMode,
                        onSelect = viewModel::setThemeMode,
                    )
                    AccentColorCard(
                        selectedKey = state.accentColor,
                        onSelect = viewModel::setAccentColor,
                    )
                }
            }

            if (state.workspaceMode == WorkspaceMode.SERVER) {
                item {
                    SettingsSection(
                        title = stringResource(R.string.settings_server),
                        subtitle = stringResource(R.string.settings_server_description),
                    ) {
                        ServerInfoCard(
                            version = state.health?.version,
                            aiProvider = state.health?.aiProvider,
                            aiModel = state.health?.aiModel,
                            aiConnected = state.health?.aiConnected,
                            hostName = state.hostName,
                            authMode = state.authMode,
                        )
                    }
                }
            }

            state.diagnostics?.takeIf { state.workspaceMode == WorkspaceMode.SERVER }?.let { diagnostics ->
                item {
                    ConnectionDiagnosticsCard(
                        diagnostics = diagnostics,
                        isChecking = state.isCheckingConnection,
                        onCheck = viewModel::checkConnection,
                        onCopy = {
                            clipboard.setText(AnnotatedString(diagnostics.toLocalizedSafeReport(context)))
                            Toast.makeText(
                                context,
                                diagnosticsCopiedMessage,
                                Toast.LENGTH_SHORT,
                            ).show()
                        },
                    )
                }
            }

            if (state.workspaceMode == WorkspaceMode.SERVER && state.devices.isNotEmpty()) {
                item {
                    SettingsSection(
                        title = stringResource(R.string.settings_paired_devices),
                        subtitle = stringResource(R.string.settings_paired_devices_description),
                        count = state.devices.size,
                    ) {
                        Column {
                            state.devices.forEachIndexed { index, device ->
                                DeviceCard(
                                    device = device,
                                    onRevoke = { viewModel.revokeDevice(device.id) },
                                )
                                if (index < state.devices.lastIndex) {
                                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                }
                            }
                        }
                    }
                }
            }

            item {
                AppUpdateSection(
                    state = updateState,
                    onCheck = viewModel::checkForUpdate,
                    onDownload = viewModel::downloadUpdate,
                    onInstall = viewModel::installUpdate,
                    onToggleAutoCheck = viewModel::setAutoUpdateCheckEnabled,
                )
            }

            if (state.workspaceMode == WorkspaceMode.SERVER) {
                item {
                    SettingsSection(
                        title = stringResource(R.string.settings_account),
                        subtitle = stringResource(R.string.settings_account_description),
                        showDivider = false,
                    ) {
                        TextButton(
                            modifier = Modifier.fillMaxWidth(),
                            onClick = {
                                viewModel.logout()
                                onLoggedOut()
                            },
                            colors = ButtonDefaults.textButtonColors(
                                contentColor = MaterialTheme.colorScheme.error,
                            ),
                        ) {
                            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Icon(ClawIcons.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(8.dp))
                                Text(stringResource(R.string.settings_log_out), fontWeight = FontWeight.Medium)
                            }
                        }
                    }
                }
            }
        }
    }

    if (showLocalModeConfirmation) {
        AlertDialog(
            onDismissRequest = { showLocalModeConfirmation = false },
            title = { Text(stringResource(R.string.settings_switch_to_device_confirm_title)) },
            text = { Text(stringResource(R.string.settings_switch_to_device_confirm_message)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showLocalModeConfirmation = false
                        viewModel.switchToLocalMode()
                    },
                ) {
                    Text(stringResource(R.string.settings_use_this_device))
                }
            },
            dismissButton = {
                TextButton(onClick = { showLocalModeConfirmation = false }) {
                    Text(stringResource(R.string.settings_cancel))
                }
            },
        )
    }
}

@Composable
private fun WorkspaceModeSection(
    state: SettingsUiState,
    onConnectWorkspace: () -> Unit,
    onActivateSavedServer: () -> Unit,
    onSwitchToLocal: () -> Unit,
) {
    SettingsSection(
        title = stringResource(R.string.settings_workspace),
        subtitle = stringResource(R.string.settings_workspace_description),
    ) {
        val isLocal = state.workspaceMode == WorkspaceMode.LOCAL
        val title = when (state.workspaceMode) {
            WorkspaceMode.LOCAL -> stringResource(R.string.settings_workspace_this_device)
            WorkspaceMode.SERVER -> state.hostName.ifBlank {
                stringResource(R.string.settings_workspace_connected)
            }
            WorkspaceMode.UNCONFIGURED -> stringResource(R.string.settings_workspace_not_selected)
        }
        val description = when (state.workspaceMode) {
            WorkspaceMode.LOCAL -> stringResource(R.string.settings_workspace_local_description)
            WorkspaceMode.SERVER -> stringResource(R.string.settings_workspace_server_description)
            WorkspaceMode.UNCONFIGURED -> stringResource(R.string.settings_workspace_not_selected_description)
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .defaultMinSize(minHeight = 48.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                imageVector = if (isLocal) ClawIcons.PhoneAndroid else ClawIcons.Cloud,
                contentDescription = null,
                modifier = Modifier.size(22.dp),
                tint = MaterialTheme.colorScheme.primary,
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        when (state.workspaceMode) {
            WorkspaceMode.LOCAL,
            WorkspaceMode.UNCONFIGURED,
            -> WorkspaceActionRow(
                icon = ClawIcons.Cloud,
                title = stringResource(
                    if (state.isSwitchingWorkspace) {
                        R.string.settings_switching_workspace
                    } else {
                        R.string.settings_connect_workspace
                    },
                ),
                description = stringResource(
                    if (state.hasSavedServerSession) {
                        R.string.settings_activate_saved_workspace_description
                    } else {
                        R.string.settings_connect_workspace_description
                    },
                ),
                enabled = !state.isSwitchingWorkspace,
                onClick = if (state.hasSavedServerSession) {
                    onActivateSavedServer
                } else {
                    onConnectWorkspace
                },
            )

            WorkspaceMode.SERVER -> WorkspaceActionRow(
                icon = ClawIcons.PhoneAndroid,
                title = stringResource(R.string.settings_switch_to_device_mode),
                description = stringResource(R.string.settings_switch_to_device_mode_description),
                enabled = !state.isSwitchingWorkspace,
                onClick = onSwitchToLocal,
            )
        }
    }
}

@Composable
private fun WorkspaceActionRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .defaultMinSize(minHeight = 52.dp)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.outline,
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun SettingsSection(
    title: String,
    subtitle: String? = null,
    count: Int? = null,
    showDivider: Boolean = true,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
                .padding(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(1.dp),
                ) {
                    Text(
                        text = title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    if (!subtitle.isNullOrBlank()) {
                        Text(
                            text = subtitle,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (count != null) {
                    Text(
                        text = count.toString(),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            content()
        }
        if (showDivider) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

@Composable
private fun ConnectionDiagnosticsCard(
    diagnostics: ConnectionDiagnostics,
    isChecking: Boolean,
    onCheck: () -> Unit,
    onCopy: () -> Unit,
) {
    val isConfigured = diagnostics.serverOrigin != "Not configured"
    val context = LocalContext.current
    SettingsSection(
        title = stringResource(R.string.settings_connection_diagnostics),
        subtitle = stringResource(R.string.settings_connection_diagnostics_description),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(
                        when {
                            !isConfigured -> MaterialTheme.colorScheme.onSurfaceVariant
                            diagnostics.httpReachable -> MaterialTheme.colorScheme.secondary
                            else -> MaterialTheme.colorScheme.error
                        },
                    ),
            )
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    when {
                        !isConfigured -> stringResource(R.string.settings_no_server_configured)
                        diagnostics.httpReachable -> stringResource(R.string.settings_server_reachable)
                        else -> stringResource(R.string.settings_server_unavailable)
                    },
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    when {
                        !isConfigured -> stringResource(R.string.settings_connect_for_diagnostics)
                        diagnostics.latencyMillis != null ->
                            stringResource(
                                R.string.settings_http_check_completed,
                                diagnostics.latencyMillis,
                            )
                        else -> stringResource(R.string.settings_http_check_incomplete)
                    },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        InfoRow(
            stringResource(R.string.settings_info_server),
            context.localizedDiagnosticValue(diagnostics.serverOrigin),
        )
        InfoRow(
            stringResource(R.string.settings_info_transport),
            context.localizedDiagnosticValue(diagnostics.connectionMode),
        )
        InfoRow(
            stringResource(R.string.settings_info_authentication),
            context.localizedDiagnosticValue(diagnostics.authMode),
        )
        diagnostics.serverVersion?.let {
            InfoRow(stringResource(R.string.settings_info_server_version), it)
        }
        InfoRow(
            stringResource(R.string.settings_info_realtime),
            stringResource(
                if (diagnostics.realtimeConnected) {
                    R.string.settings_connected
                } else {
                    R.string.settings_disconnected
                },
            ),
            if (diagnostics.realtimeConnected) {
                MaterialTheme.colorScheme.secondary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
        )
        diagnostics.lastRealtimeEventAtEpochMillis?.let {
            InfoRow(
                stringResource(R.string.settings_info_last_realtime_event),
                java.time.Instant.ofEpochMilli(it).toString(),
            )
        }
        diagnostics.lastError?.let { error ->
            Text(
                text = localizedErrorMessage(error),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.End,
        ) {
            TextButton(onClick = onCopy) {
                Text(stringResource(R.string.settings_copy_diagnostics))
            }
            TextButton(onClick = onCheck, enabled = !isChecking && isConfigured) {
                Text(
                    stringResource(
                        if (isChecking) R.string.settings_checking else R.string.settings_run_again,
                    ),
                )
            }
        }
    }
}

@Composable
private fun ThemeModeCard(
    selectedKey: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.settings_theme_mode),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            ThemeMode.entries.forEach { mode ->
                ThemeModeOption(
                    mode = mode,
                    isSelected = selectedKey == mode.key,
                    modifier = Modifier.weight(1f),
                    onClick = { onSelect(mode.key) },
                )
            }
        }
    }
}

@Composable
private fun ThemeModeOption(
    mode: ThemeMode,
    isSelected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    val containerColor = if (isSelected) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.10f)
    } else {
        MaterialTheme.colorScheme.surface
    }
    val borderColor = if (isSelected) {
        MaterialTheme.colorScheme.primary.copy(alpha = 0.18f)
    } else {
        MaterialTheme.colorScheme.outlineVariant
    }

    Surface(
        modifier = modifier,
        onClick = onClick,
        shape = RoundedCornerShape(6.dp),
        color = containerColor,
        border = androidx.compose.foundation.BorderStroke(1.dp, borderColor),
        tonalElevation = 0.dp,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(width = 42.dp, height = 26.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(
                        when (mode) {
                            ThemeMode.Light -> Color(0xFFF7F8FA)
                            ThemeMode.Dark -> Color(0xFF181B1F)
                            ThemeMode.System -> Color(0xFFE3E6EA)
                        },
                    )
                    .border(
                        1.dp,
                        when (mode) {
                            ThemeMode.Light -> Color(0xFFDDE1E6)
                            ThemeMode.Dark -> Color(0xFF41464D)
                            ThemeMode.System -> Color(0xFFC8CDD3)
                        },
                        RoundedCornerShape(4.dp),
                    ),
            )
            Text(
                text = mode.localizedLabel(),
                style = MaterialTheme.typography.labelLarge,
                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium,
                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun AccentColorCard(
    selectedKey: String,
    onSelect: (String) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            stringResource(R.string.settings_accent_color),
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            AccentColor.entries.forEach { accent ->
                AccentSwatch(
                    color = Color(accent.swatchArgb),
                    label = accent.localizedLabel(),
                    isSelected = accent.key == selectedKey,
                    onClick = { onSelect(accent.key) },
                )
            }
        }
    }
}

@Composable
private fun AccentSwatch(
    color: Color,
    label: String,
    isSelected: Boolean,
    onClick: () -> Unit,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.width(48.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(48.dp)
                .clickable(role = Role.RadioButton, onClick = onClick),
        ) {
            Box(
                contentAlignment = Alignment.Center,
                modifier = Modifier
                    .size(32.dp)
                    .clip(CircleShape)
                    .background(color)
                    .then(
                        if (isSelected) {
                            Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape)
                        } else {
                            Modifier
                        },
                    ),
            ) {
                if (isSelected) {
                    Icon(
                        Icons.Default.Check,
                        contentDescription = stringResource(R.string.settings_selected),
                        tint = Color.White,
                        modifier = Modifier.size(16.dp),
                    )
                }
            }
        }
        Text(
            label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ServerInfoCard(
    version: String?,
    aiProvider: String?,
    aiModel: String?,
    aiConnected: Boolean?,
    hostName: String,
    authMode: String,
) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                ClawIcons.Cloud,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.width(10.dp))
            val aiOk = aiConnected == true
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (aiOk) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                stringResource(
                    if (aiOk) R.string.settings_connected else R.string.settings_connection_details,
                ),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
            )
        }

        if (hostName.isNotBlank()) InfoRow(stringResource(R.string.settings_info_host), hostName)
        version?.let { InfoRow(stringResource(R.string.settings_info_version), it) }
        aiProvider?.let { InfoRow(stringResource(R.string.settings_info_ai_provider), it) }
        aiModel?.let { InfoRow(stringResource(R.string.settings_info_model), it) }
        aiConnected?.let {
            val statusColor = if (it) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error
            InfoRow(
                label = stringResource(R.string.settings_info_ai_status),
                value = stringResource(
                    if (it) R.string.settings_connected else R.string.settings_disconnected,
                ),
                valueColor = statusColor,
            )
        }
        if (authMode.isNotBlank()) {
            InfoRow(
                stringResource(R.string.settings_info_auth_mode),
                LocalContext.current.localizedDiagnosticValue(authMode),
            )
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String, valueColor: Color? = null) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 2.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            label,
            modifier = Modifier.weight(0.42f),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            value,
            modifier = Modifier.weight(0.58f),
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = valueColor ?: MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.End,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
}

@Composable
private fun DeviceCard(device: PairedDevice, onRevoke: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .defaultMinSize(minHeight = 56.dp)
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            ClawIcons.PhoneAndroid,
            contentDescription = null,
            modifier = Modifier.size(20.dp),
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                device.name,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(1.dp))
            Text(
                stringResource(
                    R.string.settings_device_last_seen,
                    device.deviceType,
                    device.lastSeen,
                ),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        TextButton(
            onClick = onRevoke,
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) {
            Text(stringResource(R.string.settings_revoke), style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
private fun ThemeMode.localizedLabel(): String = stringResource(
    when (this) {
        ThemeMode.Light -> R.string.settings_theme_light
        ThemeMode.Dark -> R.string.settings_theme_dark
        ThemeMode.System -> R.string.settings_system
    },
)

@Composable
private fun AccentColor.localizedLabel(): String = stringResource(
    when (this) {
        AccentColor.System -> R.string.settings_system
        AccentColor.Purple -> R.string.settings_accent_purple
        AccentColor.Blue -> R.string.settings_accent_blue
        AccentColor.Teal -> R.string.settings_accent_teal
        AccentColor.Green -> R.string.settings_accent_green
        AccentColor.Orange -> R.string.settings_accent_orange
        AccentColor.Pink -> R.string.settings_accent_pink
        AccentColor.Red -> R.string.settings_accent_red
    },
)

/** Maps stable diagnostics tokens for display without changing their comparison semantics. */
private fun Context.localizedDiagnosticValue(value: String): String = getString(
    when (value) {
        "Not configured" -> R.string.settings_value_not_configured
        "Configured" -> R.string.settings_value_configured
        "Configured (address hidden)" -> R.string.settings_value_configured_hidden
        "Direct" -> R.string.settings_value_direct
        "Direct with relay fallback" -> R.string.settings_value_direct_relay
        "paired", "Paired device" -> R.string.settings_value_paired_device
        "manual", "PIN session" -> R.string.settings_value_pin_session
        else -> return value
    },
)

private fun ConnectionDiagnostics.toLocalizedSafeReport(context: Context): String = buildString {
    val authentication = context.localizedDiagnosticValue(authMode)
    val session = context.getString(
        if (hasSession) R.string.settings_report_session_present else R.string.settings_report_no_session,
    )
    val reachability = context.getString(
        if (httpReachable) R.string.settings_report_reachable else R.string.settings_report_unreachable,
    )
    val realtime = context.getString(
        if (realtimeConnected) R.string.settings_connected else R.string.settings_disconnected,
    )
    val unknown = context.getString(R.string.settings_report_unknown)
    val none = context.getString(R.string.settings_report_none)

    appendLine(context.getString(R.string.settings_report_header))
    appendLine(
        context.getString(
            R.string.settings_report_server,
            context.localizedDiagnosticValue(serverOrigin),
        ),
    )
    appendLine(
        context.getString(
            R.string.settings_report_mode,
            context.localizedDiagnosticValue(connectionMode),
        ),
    )
    appendLine(context.getString(R.string.settings_report_authentication, authentication, session))
    appendLine(
        if (latencyMillis != null) {
            context.getString(R.string.settings_report_http_latency, reachability, latencyMillis)
        } else {
            context.getString(R.string.settings_report_http, reachability)
        },
    )
    appendLine(context.getString(R.string.settings_report_server_status, serverStatus ?: unknown))
    appendLine(context.getString(R.string.settings_report_server_version, serverVersion ?: unknown))
    appendLine(context.getString(R.string.settings_report_realtime, realtime))
    appendLine(
        context.getString(
            R.string.settings_report_last_realtime_event,
            lastRealtimeEventAtEpochMillis?.let { java.time.Instant.ofEpochMilli(it).toString() } ?: none,
        ),
    )
    appendLine(context.getString(R.string.settings_report_last_error, lastError ?: none))
    append(context.getString(R.string.settings_report_checked, java.time.Instant.ofEpochMilli(checkedAtEpochMillis)))
}
