package com.clawchat.android.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import com.clawchat.android.core.network.SseEvent
import com.clawchat.android.core.network.streamChat
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import javax.inject.Inject

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
    private val api: ClawChatApi,
    private val sessionStore: SessionStore,
    @com.clawchat.android.core.di.AuthenticatedClient private val httpClient: OkHttpClient,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private var streamJob: Job? = null

    init {
        loadConversations()
    }

    fun loadConversations() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingConversations = true) }
            try {
                val resp = api.listConversations()
                _uiState.update { it.copy(conversations = resp.items, isLoadingConversations = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoadingConversations = false, error = e.message) }
            }
        }
    }

    fun selectConversation(id: String) {
        _uiState.update { it.copy(selectedConversationId = id, messages = emptyList()) }
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingMessages = true) }
            try {
                val resp = api.getMessages(id)
                _uiState.update { it.copy(messages = resp.items.reversed(), isLoadingMessages = false) }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoadingMessages = false, error = e.message) }
            }
        }
    }

    fun createConversation() {
        viewModelScope.launch {
            try {
                val convo = api.createConversation(mapOf("title" to "New Conversation"))
                _uiState.update {
                    it.copy(
                        conversations = listOf(convo) + it.conversations,
                        selectedConversationId = convo.id,
                        messages = emptyList(),
                    )
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(error = e.message) }
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

            streamChat(httpClient, baseUrl, conversationId, text, token)
                .collect { event ->
                    when (event) {
                        is SseEvent.Token -> {
                            _uiState.update { it.copy(streamingText = it.streamingText + event.text) }
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
                            val assistantMsg = Message(
                                id = "stream-${System.currentTimeMillis()}",
                                content = _uiState.value.streamingText,
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
        val finalText = _uiState.value.streamingText
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
