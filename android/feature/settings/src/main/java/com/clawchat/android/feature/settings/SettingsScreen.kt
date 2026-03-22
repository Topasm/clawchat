package com.clawchat.android.feature.settings

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import com.clawchat.android.core.ui.icons.ClawIcons
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.clawchat.android.core.data.model.PairedDevice

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onLoggedOut: () -> Unit = {},
    onSetupServer: () -> Unit = {},
    viewModel: SettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    Scaffold(
        topBar = { TopAppBar(title = { Text("Settings") }) },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Server setup prompt (when onboarding was skipped)
            if (state.hostName.isBlank() && state.health == null) {
                item {
                    ElevatedCard(
                        onClick = onSetupServer,
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Row(
                            modifier = Modifier.padding(16.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                ClawIcons.Cloud,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Spacer(Modifier.width(12.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text("Connect to Server", style = MaterialTheme.typography.titleMedium)
                                Text(
                                    "Set up your ClawChat server connection",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }

            // Server info card
            if (state.hostName.isNotBlank() || state.health != null) {
                item {
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

            // Paired devices
            if (state.devices.isNotEmpty()) {
                item {
                    Text("Paired Devices", style = MaterialTheme.typography.titleMedium)
                }
                items(state.devices, key = { it.id }) { device ->
                    DeviceCard(
                        device = device,
                        onRevoke = { viewModel.revokeDevice(device.id) },
                    )
                }
            }

            // Logout
            item {
                Spacer(Modifier.height(16.dp))
                OutlinedButton(
                    onClick = {
                        viewModel.logout()
                        onLoggedOut()
                    },
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
                ) {
                    Icon(ClawIcons.Logout, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Log Out")
                }
            }
        }
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
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(ClawIcons.Cloud, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(12.dp))
                Text("Server", style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.height(12.dp))

            if (hostName.isNotBlank()) {
                InfoRow("Host", hostName)
            }
            version?.let { InfoRow("Version", it) }
            aiProvider?.let { InfoRow("AI Provider", it) }
            aiModel?.let { InfoRow("Model", it) }
            aiConnected?.let {
                InfoRow("AI Status", if (it) "Connected" else "Disconnected")
            }
            if (authMode.isNotBlank()) {
                InfoRow("Auth Mode", authMode)
            }
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun DeviceCard(device: PairedDevice, onRevoke: () -> Unit) {
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(ClawIcons.PhoneAndroid, contentDescription = null)
            Spacer(Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(device.name, style = MaterialTheme.typography.bodyLarge)
                Text(
                    "${device.deviceType} · Last seen ${device.lastSeen}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            TextButton(onClick = onRevoke, colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                Text("Revoke")
            }
        }
    }
}
