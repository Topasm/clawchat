package com.clawchat.android.feature.onboarding

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.api.PairingApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.LoginRequest
import com.clawchat.android.core.data.model.PairingClaimRequest
import com.clawchat.android.core.di.DebugServerUrl
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class OnboardingStep { WELCOME, SCAN_QR, SERVER, PAIRING, MANUAL_LOGIN, READY }

data class OnboardingUiState(
    val step: OnboardingStep = OnboardingStep.WELCOME,
    val serverUrl: String = "",
    val serverReachable: Boolean? = null,
    val isCheckingServer: Boolean = false,
    val pairingCode: String = "",
    val isPairing: Boolean = false,
    val pin: String = "",
    val isLoggingIn: Boolean = false,
    val error: String? = null,
    val serverVersion: String? = null,
    val autoClaimAfterHealthCheck: Boolean = false,
    val expectedHostId: String? = null,
    val expectedHostPublicKey: String? = null,
)

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val pairingApi: PairingApi,
    private val sessionStore: SessionStore,
    @param:DebugServerUrl private val debugServerUrl: String,
) : ViewModel() {

    private val _uiState = MutableStateFlow(OnboardingUiState(serverUrl = debugServerUrl))
    val uiState: StateFlow<OnboardingUiState> = _uiState.asStateFlow()

    fun updateServerUrl(url: String) {
        _uiState.update {
            it.copy(
                serverUrl = url,
                serverReachable = null,
                serverVersion = null,
                autoClaimAfterHealthCheck = false,
                expectedHostId = null,
                expectedHostPublicKey = null,
                error = null,
            )
        }
    }

    fun updatePairingCode(code: String) {
        _uiState.update {
            it.copy(
                pairingCode = code,
                autoClaimAfterHealthCheck = false,
                expectedHostId = null,
                expectedHostPublicKey = null,
                error = null,
            )
        }
    }

    fun updatePin(pin: String) {
        _uiState.update { it.copy(pin = pin, error = null) }
    }

    fun goToStep(step: OnboardingStep) {
        _uiState.update { it.copy(step = step, error = null) }
    }

    fun checkServer() {
        val url = _uiState.value.serverUrl.trimEnd('/')
        if (url.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(isCheckingServer = true, error = null) }
            try {
                val health = pairingApi.health("$url/api/health")
                _uiState.update {
                    it.copy(
                        isCheckingServer = false,
                        serverReachable = true,
                        serverVersion = health.version,
                    )
                }
                if (_uiState.value.autoClaimAfterHealthCheck) {
                    _uiState.update { it.copy(autoClaimAfterHealthCheck = false) }
                    claimPairingCode()
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        isCheckingServer = false,
                        serverReachable = false,
                        error = "Cannot reach server: ${e.message}",
                    )
                }
            }
        }
    }

    fun claimPairingCode() {
        val state = _uiState.value
        val url = state.serverUrl.trimEnd('/')
        val code = state.pairingCode
        val expectedKey = state.expectedHostPublicKey
        val expectedId = state.expectedHostId

        if (url.isBlank() || code.length != 6) return

        viewModelScope.launch {
            _uiState.update { it.copy(isPairing = true, error = null) }
            try {
                val response = pairingApi.claimPairing(
                    url = "$url/api/pairing/claim",
                    body = PairingClaimRequest(
                        code = code,
                        deviceName = Build.MODEL,
                        deviceType = "android",
                    ),
                )
                if (expectedKey != null && response.hostPublicKey != expectedKey) {
                    error("Host identity did not match the scanned QR code")
                }
                if (expectedId != null && response.hostId != expectedId) {
                    error("Host ID did not match the scanned QR code")
                }
                sessionStore.savePairedSession(
                    deviceId = response.deviceId,
                    deviceToken = response.deviceToken,
                    apiBaseUrl = response.apiBaseUrl,
                    hostName = response.hostName,
                    hostId = response.hostId,
                    hostPublicKey = response.hostPublicKey,
                    relayUrl = response.relayUrl,
                )
                _uiState.update { it.copy(isPairing = false, step = OnboardingStep.READY) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isPairing = false, error = "Pairing failed: ${e.message}")
                }
            }
        }
    }

    fun loginWithPin() {
        val url = _uiState.value.serverUrl.trimEnd('/')
        val pin = _uiState.value.pin

        if (url.isBlank() || pin.isBlank()) return

        viewModelScope.launch {
            _uiState.update { it.copy(isLoggingIn = true, error = null) }
            try {
                val response = pairingApi.login(
                    url = "$url/api/auth/login",
                    body = LoginRequest(pin = pin),
                )
                sessionStore.saveManualSession(
                    accessToken = response.accessToken,
                    refreshToken = response.refreshToken,
                    apiBaseUrl = url,
                )
                _uiState.update { it.copy(isLoggingIn = false, step = OnboardingStep.READY) }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(isLoggingIn = false, error = "Login failed: ${e.message}")
                }
            }
        }
    }

    /** Skip onboarding — set up server later. */
    fun skipOnboarding() {
        viewModelScope.launch {
            sessionStore.markOnboardingSkipped()
        }
    }

    /** Parse a scanned QR payload and auto-fill server URL + code. */
    fun handleQrPayload(json: String) {
        try {
            val obj = org.json.JSONObject(json)
            if (obj.optString("type") != "clawchat_pair") return
            val serverUrl = obj.optString("server_url", "")
            val code = obj.optString("code", "")
            val hostId = obj.optString("host_id", "").ifBlank { null }
            val hostPublicKey = obj.optString("host_public_key", "").ifBlank { null }
            if (serverUrl.isNotBlank() && code.isNotBlank()) {
                _uiState.update {
                    it.copy(
                        serverUrl = serverUrl,
                        pairingCode = code,
                        autoClaimAfterHealthCheck = true,
                        expectedHostId = hostId,
                        expectedHostPublicKey = hostPublicKey,
                    )
                }
                checkServer()
            }
        } catch (_: Exception) {
            // Not valid QR payload
        }
    }
}
