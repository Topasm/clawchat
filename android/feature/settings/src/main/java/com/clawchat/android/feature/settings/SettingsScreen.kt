@file:OptIn(ExperimentalLayoutApi::class)

package com.clawchat.android.feature.settings

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.clawchat.android.core.data.model.PairedDevice
import com.clawchat.android.core.ui.ClawListItemSurface
import com.clawchat.android.core.ui.ClawSectionCard
import com.clawchat.android.core.ui.ClawSectionHeader
import com.clawchat.android.core.ui.ClawStatusChip
import com.clawchat.android.core.ui.ClawTone
import com.clawchat.android.core.ui.ClawTopBarColors
import com.clawchat.android.core.ui.theme.AccentColor
import com.clawchat.android.core.ui.update.AppUpdateSection
import com.clawchat.android.core.ui.theme.ThemeMode
import com.clawchat.android.core.ui.icons.ClawIcons

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit = {},
    onLoggedOut: () -> Unit = {},
    onSetupServer: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val updateState by viewModel.updateState.collectAsStateWithLifecycle()
    val clipboard = LocalClipboardManager.current
    val context = LocalContext.current

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        "Settings",
                        fontWeight = FontWeight.SemiBold,
                        style = MaterialTheme.typography.headlineSmall,
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                        )
                    }
                },
                colors = ClawTopBarColors(),
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item {
                ClawSectionCard {
                    ClawStatusChip(
                        text = "Appearance",
                        tone = ClawTone.Primary,
                    )
                    Text(
                        text = "Choose the calmer, lighter presentation you want across the app.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
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

            if (state.hostName.isBlank() && state.health == null) {
                item {
                    ConnectServerCard(onSetupServer = onSetupServer)
                }
            }

            if (state.hostName.isNotBlank() || state.health != null) {
                item {
                    ClawSectionCard {
                        ClawSectionHeader(
                            title = "Server",
                            subtitle = "Connection and AI status.",
                        )
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

            state.diagnostics?.let { diagnostics ->
                item {
                    ConnectionDiagnosticsCard(
                        diagnostics = diagnostics,
                        isChecking = state.isCheckingConnection,
                        onCheck = viewModel::checkConnection,
                        onCopy = {
                            clipboard.setText(AnnotatedString(diagnostics.toSafeReport()))
                            Toast.makeText(context, "Diagnostics copied", Toast.LENGTH_SHORT).show()
                        },
                    )
                }
            }

            if (state.devices.isNotEmpty()) {
                item {
                    ClawSectionCard {
                        ClawSectionHeader(
                            title = "Paired devices",
                            subtitle = "Active mobile connections.",
                            count = state.devices.size,
                        )
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            state.devices.forEach { device ->
                                DeviceCard(
                                    device = device,
                                    onRevoke = { viewModel.revokeDevice(device.id) },
                                )
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

            item {
                ClawSectionCard {
                    ClawSectionHeader(
                        title = "Account",
                        subtitle = "Sign out while keeping your visual preferences.",
                    )
                    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    TextButton(
                        onClick = {
                            viewModel.logout()
                            onLoggedOut()
                        },
                        colors = ButtonDefaults.textButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        ),
                    ) {
                        Icon(ClawIcons.Logout, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(8.dp))
                        Text("Log Out", fontWeight = FontWeight.Medium)
                    }
                }
            }
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
    ClawSectionCard {
        ClawSectionHeader(
            title = "Connection diagnostics",
            subtitle = "A credential-safe snapshot for troubleshooting this device.",
        )
        ClawListItemSurface {
            Row(
                modifier = Modifier.fillMaxWidth(),
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
                            !isConfigured -> "No server configured"
                            diagnostics.httpReachable -> "Server reachable"
                            else -> "Server unavailable"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        when {
                            !isConfigured -> "Connect a server to run diagnostics"
                            diagnostics.latencyMillis != null ->
                                "HTTP check completed in ${diagnostics.latencyMillis}ms"
                            else -> "HTTP check did not complete"
                        },
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            InfoRow("Server", diagnostics.serverOrigin)
            InfoRow("Transport", diagnostics.connectionMode)
            InfoRow("Authentication", diagnostics.authMode)
            diagnostics.serverVersion?.let { InfoRow("Server version", it) }
            InfoRow(
                "Realtime",
                if (diagnostics.realtimeConnected) "Connected" else "Disconnected",
                if (diagnostics.realtimeConnected) {
                    MaterialTheme.colorScheme.secondary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            diagnostics.lastRealtimeEventAtEpochMillis?.let {
                InfoRow("Last realtime event", java.time.Instant.ofEpochMilli(it).toString())
            }
            diagnostics.lastError?.let { error ->
                Text(
                    text = error,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                TextButton(onClick = onCopy) {
                    Text("Copy diagnostics")
                }
                TextButton(onClick = onCheck, enabled = !isChecking && isConfigured) {
                    Text(if (isChecking) "Checking…" else "Run again")
                }
            }
        }
    }
}

@Composable
private fun ConnectServerCard(onSetupServer: () -> Unit) {
    ClawSectionCard(tone = ClawTone.Primary, onClick = onSetupServer) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                modifier = Modifier.size(44.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        ClawIcons.Cloud,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(22.dp),
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    "Connect to Server",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    "Set up your ClawChat server connection.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
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
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(
            "Theme mode",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
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
        shape = MaterialTheme.shapes.large,
        color = containerColor,
        border = androidx.compose.foundation.BorderStroke(1.dp, borderColor),
        tonalElevation = 0.dp,
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Box(
                modifier = Modifier
                    .size(width = 42.dp, height = 26.dp)
                    .clip(MaterialTheme.shapes.medium)
                    .background(
                        when (mode) {
                            ThemeMode.Light -> Color(0xFFF9F7F3)
                            ThemeMode.Dark -> Color(0xFF252320)
                            ThemeMode.System -> Color(0xFFE7E1D8)
                        },
                    )
                    .border(
                        1.dp,
                        when (mode) {
                            ThemeMode.Light -> Color(0xFFE0D9CF)
                            ThemeMode.Dark -> Color(0xFF555049)
                            ThemeMode.System -> Color(0xFFD2CBC2)
                        },
                        MaterialTheme.shapes.medium,
                    ),
            )
            Text(
                text = mode.label,
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
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            "Accent color",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.SemiBold,
        )
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            AccentColor.entries.forEach { accent ->
                AccentSwatch(
                    color = Color(accent.swatchArgb),
                    label = accent.label,
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
                .size(36.dp)
                .clip(CircleShape)
                .background(color)
                .then(
                    if (isSelected) {
                        Modifier.border(2.dp, MaterialTheme.colorScheme.onSurface, CircleShape)
                    } else {
                        Modifier
                    },
                )
                .clickable(role = Role.RadioButton, onClick = onClick),
        ) {
            if (isSelected) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = "Selected",
                    tint = Color.White,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        Spacer(Modifier.height(4.dp))
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
    ClawListItemSurface {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primary.copy(alpha = 0.10f),
                modifier = Modifier.size(36.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        ClawIcons.Cloud,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
            Spacer(Modifier.width(12.dp))
            val aiOk = aiConnected == true
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(if (aiOk) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.outline),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                if (aiOk) "Connected" else "Connection details",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Medium,
            )
        }

        if (hostName.isNotBlank()) InfoRow("Host", hostName)
        version?.let { InfoRow("Version", it) }
        aiProvider?.let { InfoRow("AI Provider", it) }
        aiModel?.let { InfoRow("Model", it) }
        aiConnected?.let {
            val statusColor = if (it) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.error
            InfoRow(
                label = "AI Status",
                value = if (it) "Connected" else "Disconnected",
                valueColor = statusColor,
            )
        }
        if (authMode.isNotBlank()) InfoRow("Auth Mode", authMode)
    }
}

@Composable
private fun InfoRow(label: String, value: String, valueColor: Color? = null) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = valueColor ?: MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun DeviceCard(device: PairedDevice, onRevoke: () -> Unit) {
    ClawListItemSurface {
        Row(
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.surfaceContainerLow,
                modifier = Modifier.size(40.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        ClawIcons.PhoneAndroid,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            Spacer(Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    device.name,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    "${device.deviceType} \u00b7 Last seen ${device.lastSeen}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(
                onClick = onRevoke,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) {
                Text("Revoke", style = MaterialTheme.typography.labelLarge)
            }
        }
    }
}
