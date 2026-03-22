package com.clawchat.android.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import com.clawchat.android.core.data.repository.ConversationRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.SseEvent
import com.clawchat.android.core.network.streamChat
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import javax.inject.Inject

private const val TOKEN_BATCH_SIZE = 4

data class ChatUiState(
    val conversations: List<Conversation> = emptyList(),
    val isLoadingConversations: Boolean = false,
    val selectedConversationId: String? = null,
    val messages: List<Message> = emptyList(),
    val isLoadingMessages: Boolean = false,
    val streamingText: String = "",
    val isStreaming: Boolean = false,
    val error: String? = null,
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val conversationRepository: ConversationRepository,
    private val sessionStore: SessionStore,
    @com.clawchat.android.core.di.AuthenticatedClient private val httpClient: OkHttpClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private var streamJob: Job? = null
    private val streamBuffer = StringBuilder()

    init {
        loadConversations()
    }

    fun loadConversations() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingConversations = true) }
            when (val result = conversationRepository.listConversations()) {
                is ApiResult.Success -> _uiState.update { it.copy(conversations = result.data.items, isLoadingConversations = false) }
                is ApiResult.Error -> _uiState.update { it.copy(isLoadingConversations = false, error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    fun selectConversation(id: String) {
        _uiState.update { it.copy(selectedConversationId = id, messages = emptyList()) }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingMessages = true) }
            when (val result = conversationRepository.getMessages(id)) {
                is ApiResult.Success -> _uiState.update { it.copy(messages = result.data.items.reversed(), isLoadingMessages = false) }
                is ApiResult.Error -> _uiState.update { it.copy(isLoadingMessages = false, error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    fun createConversation() {
        viewModelScope.launch {
            when (val result = conversationRepository.createConversation(mapOf("title" to "New Conversation"))) {
                is ApiResult.Success -> {
                    val convo = result.data
                    _uiState.update {
                        it.copy(
                            conversations = listOf(convo) + it.conversations,
                            selectedConversationId = convo.id,
                            messages = emptyList(),
                        )
                    }
                }
                is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    fun sendMessage(text: String) {
        val conversationId = _uiState.value.selectedConversationId ?: return
        if (text.isBlank()) return

        // Add user message to UI
        val userMsg = Message(
            id = "local-${System.currentTimeMillis()}",
            content = text,
            role = "user",
            createdAt = java.time.Instant.now().toString(),
        )
        _uiState.update {
            it.copy(messages = it.messages + userMsg, streamingText = "", isStreaming = true)
        }

        streamJob = viewModelScope.launch {
            val baseUrl = sessionStore.apiBaseUrl.first() ?: return@launch
            val token = sessionStore.token.first() ?: return@launch
            streamBuffer.clear()
            var tokenCount = 0

            streamChat(httpClient, baseUrl, conversationId, text, token)
                .collect { event ->
                    when (event) {
                        is SseEvent.Token -> {
                            streamBuffer.append(event.text)
                            tokenCount++
                            // Batch UI updates to reduce recompositions
                            if (tokenCount % TOKEN_BATCH_SIZE == 0) {
                                val snapshot = streamBuffer.toString()
                                _uiState.update { it.copy(streamingText = snapshot) }
                            }
                        }
                        is SseEvent.TitleGenerated -> {
                            _uiState.update { state ->
                                state.copy(
                                    conversations = state.conversations.map { c ->
                                        if (c.id == conversationId) c.copy(title = event.title) else c
                                    }
                                )
                            }
                        }
                        is SseEvent.Done -> {
                            val finalText = streamBuffer.toString()
                            val assistantMsg = Message(
                                id = "stream-${System.currentTimeMillis()}",
                                content = finalText,
                                role = "assistant",
                                createdAt = java.time.Instant.now().toString(),
                            )
                            _uiState.update {
                                it.copy(
                                    messages = it.messages + assistantMsg,
                                    streamingText = "",
                                    isStreaming = false,
                                )
                            }
                        }
                        is SseEvent.Error -> {
                            _uiState.update { it.copy(isStreaming = false, error = event.message) }
                        }
                        is SseEvent.Meta -> { /* Update message IDs if needed */ }
                    }
                }
        }
    }

    fun stopStreaming() {
        streamJob?.cancel()
        streamJob = null
        // Use buffer directly — it may contain unflushed tokens
        val finalText = streamBuffer.toString().ifBlank { _uiState.value.streamingText }
        streamBuffer.clear()
        if (finalText.isNotBlank()) {
            val assistantMsg = Message(
                id = "stopped-${System.currentTimeMillis()}",
                content = finalText,
                role = "assistant",
                createdAt = java.time.Instant.now().toString(),
            )
            _uiState.update {
                it.copy(messages = it.messages + assistantMsg, streamingText = "", isStreaming = false)
            }
        } else {
            _uiState.update { it.copy(isStreaming = false, streamingText = "") }
        }
    }

    fun clearSelection() {
        _uiState.update { it.copy(selectedConversationId = null, messages = emptyList()) }
    }
}
