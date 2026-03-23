package com.clawchat.android.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.HealthResponse
import com.clawchat.android.core.data.model.PairedDevice
import com.clawchat.android.core.data.repository.DeviceRepository
import com.clawchat.android.core.data.repository.SettingsRepository
import com.clawchat.android.core.network.ApiResult
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
    val isLoading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val deviceRepository: DeviceRepository,
    private val sessionStore: SessionStore,
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val hostName = sessionStore.hostName.first() ?: ""
            val authMode = sessionStore.authMode.first() ?: ""
            val accentColor = sessionStore.accentColor.first()
            val themeMode = sessionStore.themeMode.first()
            _uiState.update {
                it.copy(
                    hostName = hostName,
                    authMode = authMode,
                    accentColor = accentColor,
                    themeMode = themeMode,
                )
            }

            when (val result = settingsRepository.health()) {
                is ApiResult.Success -> _uiState.update { it.copy(health = result.data) }
                else -> { /* Ignore */ }
            }

            when (val result = deviceRepository.listDevices()) {
                is ApiResult.Success -> _uiState.update { it.copy(devices = result.data.devices) }
                else -> { /* Ignore — might not have user-level auth */ }
            }

            _uiState.update { it.copy(isLoading = false) }
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

    fun logout() {
        viewModelScope.launch {
            sessionStore.clearSession()
        }
    }
}
