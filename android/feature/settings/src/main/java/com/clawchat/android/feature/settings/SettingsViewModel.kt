package com.clawchat.android.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
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
    val workspaceMode: WorkspaceMode = WorkspaceMode.UNCONFIGURED,
    val hasSavedServerSession: Boolean = false,
    val health: HealthResponse? = null,
    val devices: List<PairedDevice> = emptyList(),
    val hostName: String = "",
    val authMode: String = "",
    val accentColor: String = "system",
    val themeMode: String = "light",
    val diagnostics: ConnectionDiagnostics? = null,
    val isSwitchingWorkspace: Boolean = false,
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
            loadSettings()
        }
    }

    private suspend fun loadSettings() {
        _uiState.update {
            it.copy(
                isLoading = true,
                isCheckingConnection = false,
                error = null,
            )
        }

        val runtimeState = sessionStore.runtimeState.first()
        val isServer = runtimeState.mode == WorkspaceMode.SERVER && runtimeState.activeSession != null
        val hostName = if (isServer) sessionStore.hostName.first().orEmpty() else ""
        val authMode = runtimeState.activeSession?.authMode.orEmpty()
        val accentColor = sessionStore.accentColor.first()
        val themeMode = sessionStore.themeMode.first()
        _uiState.update {
            it.copy(
                workspaceMode = runtimeState.mode,
                hasSavedServerSession = runtimeState.hasSavedServerSession,
                health = null,
                devices = emptyList(),
                hostName = hostName,
                authMode = authMode,
                accentColor = accentColor,
                themeMode = themeMode,
                diagnostics = null,
                isSwitchingWorkspace = false,
            )
        }

        if (isServer) {
            refreshConnectionDiagnostics(runtimeState.workspaceKey)

            val currentRuntimeState = sessionStore.runtimeState.first()
            if (
                currentRuntimeState.mode != WorkspaceMode.SERVER ||
                currentRuntimeState.workspaceKey != runtimeState.workspaceKey
            ) {
                _uiState.update { it.copy(isLoading = false) }
                return
            }

            when (val result = deviceRepository.listDevices()) {
                is ApiResult.Success -> {
                    val latestRuntimeState = sessionStore.runtimeState.first()
                    _uiState.update { state ->
                        if (
                            state.workspaceMode == WorkspaceMode.SERVER &&
                            latestRuntimeState.mode == WorkspaceMode.SERVER &&
                            latestRuntimeState.workspaceKey == runtimeState.workspaceKey
                        ) {
                            state.copy(devices = result.data.devices)
                        } else {
                            state
                        }
                    }
                }
                else -> { /* Ignore — might not have user-level auth */ }
            }
        }

        _uiState.update { it.copy(isLoading = false) }
    }

    fun checkConnection() {
        viewModelScope.launch {
            val runtimeState = sessionStore.runtimeState.first()
            if (runtimeState.mode == WorkspaceMode.SERVER) {
                refreshConnectionDiagnostics(runtimeState.workspaceKey)
            }
        }
    }

    private suspend fun refreshConnectionDiagnostics(expectedWorkspaceKey: String?) {
        _uiState.update { it.copy(isCheckingConnection = true) }

        val runtimeState = sessionStore.runtimeState.first()
        val session = runtimeState.activeSession
        if (runtimeState.mode != WorkspaceMode.SERVER || session == null) {
            _uiState.update { it.copy(health = null, diagnostics = null, isCheckingConnection = false) }
            return
        }

        val apiBaseUrl = session.apiBaseUrl
        val relayConfigured = !sessionStore.relayUrl.first().isNullOrBlank()
        val authMode = session.authMode
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

        val currentRuntimeState = sessionStore.runtimeState.first()
        if (
            currentRuntimeState.mode != WorkspaceMode.SERVER ||
            currentRuntimeState.workspaceKey != expectedWorkspaceKey
        ) {
            _uiState.update { it.copy(health = null, diagnostics = null, isCheckingConnection = false) }
            return
        }

        _uiState.update {
            it.copy(
                health = health,
                diagnostics = buildConnectionDiagnostics(
                    apiBaseUrl = apiBaseUrl,
                    relayConfigured = relayConfigured,
                    authMode = authMode,
                    hasSession = true,
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

    /** Use Room-backed data while retaining any remembered server credentials. */
    fun switchToLocalMode() {
        if (
            _uiState.value.workspaceMode == WorkspaceMode.LOCAL ||
            _uiState.value.isSwitchingWorkspace
        ) {
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isSwitchingWorkspace = true) }
            sessionStore.selectLocalMode()
            loadSettings()
        }
    }

    /** Reopens a remembered server session without asking for its PIN again. */
    fun activateSavedServer() {
        if (!_uiState.value.hasSavedServerSession || _uiState.value.isSwitchingWorkspace) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSwitchingWorkspace = true) }
            if (sessionStore.activateSavedServer()) {
                loadSettings()
            } else {
                _uiState.update {
                    it.copy(hasSavedServerSession = false, isSwitchingWorkspace = false)
                }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            sessionStore.clearSession()
        }
    }
}
