package com.clawchat.android.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.HealthResponse
import com.clawchat.android.core.data.model.PairedDevice
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
    val isLoading: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val api: ClawChatApi,
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
            _uiState.update { it.copy(hostName = hostName, authMode = authMode) }

            try {
                val health = api.health()
                _uiState.update { it.copy(health = health) }
            } catch (_: Exception) { /* Ignore */ }

            try {
                val resp = api.listDevices()
                _uiState.update { it.copy(devices = resp.devices) }
            } catch (_: Exception) { /* Ignore — might not have user-level auth */ }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    fun revokeDevice(deviceId: String) {
        viewModelScope.launch {
            try {
                api.revokeDevice(deviceId)
                _uiState.update { state ->
                    state.copy(devices = state.devices.filter { it.id != deviceId })
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
            }
        }
    }

    fun logout() {
        viewModelScope.launch {
            sessionStore.clearSession()
        }
    }
}
