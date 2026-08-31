package com.clawchat.android.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.HealthResponse
import com.clawchat.android.core.data.model.PairedDevice
import com.clawchat.android.core.data.repository.DeviceRepository
import com.clawchat.android.core.data.repository.SettingsRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import com.clawchat.android.core.update.AppUpdateManager
import com.clawchat.android.core.update.UpdateState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    val health: HealthResponse? = null,
    val devices: List<PairedDevice> = emptyList(),
    val hostName: String = "",
    val authMode: String = "",
    val accentColor: String = "system",
    val themeMode: String = "light",
    val diagnostics: ConnectionDiagnostics? = null,
    val isCheckingConnection: Boolean = false,
    val isLoading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val deviceRepository: DeviceRepository,
    private val sessionStore: SessionStore,
    private val updateManager: AppUpdateManager,
    private val syncManager: SyncManager,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    /** Shared with the launch-time prompt, so a download started there keeps its progress. */
    val updateState: StateFlow<UpdateState> = updateManager.state

    init {
        load()
        updateManager.refreshPreferences()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val hostName = sessionStore.hostName.first() ?: ""
            val authMode = sessionStore.authMode.first() ?: ""
            val accentColor = sessionStore.accentColor.first()
            val themeMode = sessionStore.themeMode.first()
            val hasSession = !sessionStore.token.first().isNullOrBlank()
            val hasServer = !sessionStore.apiBaseUrl.first().isNullOrBlank()
            _uiState.update {
                it.copy(
                    hostName = hostName,
                    authMode = authMode,
                    accentColor = accentColor,
                    themeMode = themeMode,
                )
            }

            refreshConnectionDiagnostics()

            if (hasSession && hasServer) {
                when (val result = deviceRepository.listDevices()) {
                    is ApiResult.Success -> _uiState.update { it.copy(devices = result.data.devices) }
                    else -> { /* Ignore — might not have user-level auth */ }
                }
            }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    fun checkConnection() {
        viewModelScope.launch { refreshConnectionDiagnostics() }
    }

    private suspend fun refreshConnectionDiagnostics() {
        _uiState.update { it.copy(isCheckingConnection = true) }

        val apiBaseUrl = sessionStore.apiBaseUrl.first()
        val relayConfigured = !sessionStore.relayUrl.first().isNullOrBlank()
        val authMode = sessionStore.authMode.first()
        val hasSession = !sessionStore.token.first().isNullOrBlank()
        var health: HealthResponse? = null
        var latencyMillis: Long? = null
        var httpError: String? = null
        if (!apiBaseUrl.isNullOrBlank()) {
            val startedAtNanos = System.nanoTime()
            when (val healthResult = settingsRepository.health()) {
                is ApiResult.Success -> health = healthResult.data
                is ApiResult.Error -> httpError = healthResult.message
                ApiResult.Loading -> Unit
            }
            latencyMillis = ((System.nanoTime() - startedAtNanos) / 1_000_000L).coerceAtLeast(0L)
        }

        _uiState.update {
            it.copy(
                health = health,
                diagnostics = buildConnectionDiagnostics(
                    apiBaseUrl = apiBaseUrl,
                    relayConfigured = relayConfigured,
                    authMode = authMode,
                    hasSession = hasSession,
                    health = health,
                    latencyMillis = latencyMillis,
                    realtimeConnected = syncManager.isConnected.value,
                    lastRealtimeEventAtEpochMillis = syncManager.lastEventAtEpochMillis.value,
                    realtimeError = syncManager.lastConnectionError.value,
                    httpError = httpError,
                ),
                isCheckingConnection = false,
            )
        }
    }

    fun revokeDevice(deviceId: String) {
        viewModelScope.launch {
            when (val result = deviceRepository.revokeDevice(deviceId)) {
                is ApiResult.Success -> {
                    _uiState.update { state ->
                        state.copy(devices = state.devices.filter { it.id != deviceId })
                    }
                }
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    fun setAccentColor(key: String) {
        viewModelScope.launch {
            sessionStore.setAccentColor(key)
            _uiState.update { it.copy(accentColor = key) }
        }
    }

    fun setThemeMode(key: String) {
        viewModelScope.launch {
            sessionStore.setThemeMode(key)
            _uiState.update { it.copy(themeMode = key) }
        }
    }

    fun checkForUpdate() = updateManager.checkForUpdate()

    fun downloadUpdate() = updateManager.downloadUpdate()

    fun installUpdate() = updateManager.installUpdate()

    fun setAutoUpdateCheckEnabled(enabled: Boolean) = updateManager.setAutoCheckEnabled(enabled)

    fun logout() {
        viewModelScope.launch {
            sessionStore.clearSession()
        }
    }
}
