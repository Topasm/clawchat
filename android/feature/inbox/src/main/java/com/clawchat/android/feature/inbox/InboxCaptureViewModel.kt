package com.clawchat.android.feature.inbox

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.repository.InboxPlacementRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.sync.SyncManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class InboxCaptureState(
    val server: Boolean = false,
    val captureText: String = "",
    val capturing: Boolean = false,
    val captureSaved: Boolean = false,
    val error: String? = null,
)

/** The bar at the bottom of the Inbox. The server files what it adds. */
@HiltViewModel
class InboxCaptureViewModel @Inject constructor(
    private val repository: InboxPlacementRepository,
    private val sync: SyncManager,
) : ViewModel() {
    private val state = MutableStateFlow(InboxCaptureState())
    val uiState = state.asStateFlow()
    private var scope: ExpectedSessionScope? = null
    private var scopeGeneration = 0L
    private var captureJob: Job? = null
    private var captureOperation: Triple<String, String, String>? = null

    init {
        viewModelScope.launch {
            repository.scopes.collect { next ->
                scopeGeneration++
                captureJob?.cancel()
                captureOperation = null
                scope = next
                state.value = InboxCaptureState(server = next != null)
            }
        }
    }

    fun editCapture(text: String) {
        if (!state.value.capturing) state.update { it.copy(captureText = text, captureSaved = false) }
    }

    fun capture() {
        val raw = state.value.captureText.trim()
        if (raw.isEmpty() || state.value.capturing) return
        val owner = scope
        val token = scopeGeneration
        // A retry of the same text reuses its operation, so the server never files it twice.
        val operation = captureOperation?.takeIf { it.first == raw }
            ?: Triple(raw, java.util.UUID.randomUUID().toString(), java.time.Instant.now().toString()).also { captureOperation = it }
        state.update { it.copy(capturing = true, error = null) }
        captureJob = viewModelScope.launch {
            val result = repository.capture(owner, raw, operation.second, operation.third)
            if (scopeGeneration != token) return@launch
            when (result) {
                is ApiResult.Success -> {
                    captureOperation = null
                    state.update { it.copy(capturing = false, captureText = "", captureSaved = true) }
                    sync.notifyTodoChanged()
                }
                is ApiResult.Error -> state.update { it.copy(capturing = false, error = result.message) }
                else -> state.update { it.copy(capturing = false) }
            }
        }
    }
}
