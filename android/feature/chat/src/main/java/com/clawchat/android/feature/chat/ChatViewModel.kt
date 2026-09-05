package com.clawchat.android.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import com.clawchat.android.core.data.model.ReviewDecision
import com.clawchat.android.core.data.model.AgentRunStatus
import com.clawchat.android.core.data.model.ChatPlanProposal
import com.clawchat.android.core.data.model.ChatPlanApplyRequest
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.data.repository.ConversationRepository
import com.clawchat.android.core.data.repository.ReviewRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ChatStreamer
import com.clawchat.android.core.network.SseEvent
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
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
    val isRunActionPending: Boolean = false,
    val plans: Map<String, ChatPlanProposal> = emptyMap(),
    val planChanges: Map<String, String> = emptyMap(),
    val pendingPlans: Set<String> = emptySet(),
)

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val conversationRepository: ConversationRepository,
    private val chatStreamer: ChatStreamer,
    private val agentRunRepository: AgentRunRepository,
    private val reviewRepository: ReviewRepository,
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private var streamJob: Job? = null
    private val streamBuffer = StringBuilder()
    private var selectionGeneration = 0L
    private var loadJob: Job? = null

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
        selectionGeneration++
        loadJob?.cancel()
        streamJob?.cancel()
        streamBuffer.clear()
        _uiState.update { it.copy(selectedConversationId = id, messages = emptyList(),
            streamingText = "", isStreaming = false, isLoadingMessages = true, error = null) }
        loadJob = viewModelScope.launch { refreshSelectedMessages() }
    }

    fun deleteConversation(id: String) {
        // Optimistic: the row leaves the list immediately, and comes back on
        // failure rather than leaving the user unsure whether it worked.
        val previousConversations = _uiState.value.conversations
        _uiState.update { it.copy(conversations = it.conversations.filterNot { c -> c.id == id }) }
        viewModelScope.launch {
            when (val result = conversationRepository.deleteConversation(id)) {
                is ApiResult.Success -> Unit
                is ApiResult.Error -> _uiState.update {
                    it.copy(conversations = previousConversations, error = result.message)
                }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    fun createConversation(title: String) {
        if (_uiState.value.isStreaming) stopStreaming()
        loadJob?.cancel()
        _uiState.update { it.copy(isLoadingMessages = false) }
        val generation = ++selectionGeneration
        viewModelScope.launch {
            when (val result = conversationRepository.createConversation(mapOf("title" to title))) {
                is ApiResult.Success -> {
                    val convo = result.data
                    if (generation != selectionGeneration) return@launch
                    streamJob?.cancel()
                    loadJob?.cancel()
                    streamBuffer.clear()
                    _uiState.update {
                        it.copy(
                            conversations = listOf(convo) + it.conversations,
                            selectedConversationId = convo.id,
                            messages = emptyList(),
                            isLoadingMessages = false,
                            isStreaming = false,
                            streamingText = "",
                        )
                    }
                }
                is ApiResult.Error -> if (generation == selectionGeneration) _uiState.update { it.copy(error = result.message) }
                is ApiResult.Loading -> { /* not used here */ }
            }
        }
    }

    fun sendMessage(text: String) {
        val conversationId = _uiState.value.selectedConversationId ?: return
        if (text.isBlank() || _uiState.value.isStreaming || _uiState.value.isLoadingMessages) return
        loadJob?.cancel()
        val generation = selectionGeneration

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
            streamBuffer.clear()
            var tokenCount = 0

            chatStreamer.stream(conversationId, text)
                .collect { event ->
                    if (generation != selectionGeneration) return@collect
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

    fun resumeRun(runId: String, answer: String) {
        if (answer.isBlank()) return
        performRunAction { agentRunRepository.resumeRun(runId, answer) }
    }

    fun resolvePermission(runId: String, allow: Boolean) {
        performRunAction { agentRunRepository.resolvePermission(runId, allow) }
    }

    fun decideReview(reviewId: String, approve: Boolean) {
        decideReview(reviewId, if (approve) ReviewDecision.APPROVED else ReviewDecision.REJECTED, null)
    }

    fun decideReview(reviewId: String, decision: ReviewDecision, note: String?) {
        if (decision == ReviewDecision.CHANGES_REQUESTED && note.isNullOrBlank()) return
        performRunAction { reviewRepository.decideById(reviewId, decision, note?.trim()) }
    }

    /** One in-flight mutation, with responses scoped to the thread that initiated it. */
    private fun performRunAction(action: suspend () -> ApiResult<*>) {
        if (_uiState.value.isRunActionPending) return
        val generation = selectionGeneration
        loadJob?.cancel()
        disableRunActions()
        viewModelScope.launch {
            try {
                val result = action()
                if (generation != selectionGeneration) return@launch
                when (result) {
                    is ApiResult.Success -> refreshSelectedMessages()
                    is ApiResult.Error -> _uiState.update { it.copy(error = result.message) }
                    is ApiResult.Loading -> Unit
                }
            } finally {
                _uiState.update { it.copy(isRunActionPending = false) }
            }
        }
    }

    private suspend fun refreshSelectedMessages() {
        val conversationId = _uiState.value.selectedConversationId ?: return
        val generation = selectionGeneration
        val result = conversationRepository.getMessages(conversationId)
        if (generation != selectionGeneration) return
        when (result) {
            is ApiResult.Success -> _uiState.update {
                it.copy(messages = result.data.items.reversed(), error = null, isLoadingMessages = false)
            }
            is ApiResult.Error -> _uiState.update { it.copy(error = result.message, isLoadingMessages = false) }
            is ApiResult.Loading -> Unit
        }
        if (result is ApiResult.Success) refreshRunActions(generation)
        if (result is ApiResult.Success && generation == selectionGeneration) refreshPlans(generation)
    }

    fun refreshConversation() {
        if (_uiState.value.isStreaming || _uiState.value.isLoadingMessages || loadJob?.isActive == true || _uiState.value.isRunActionPending || _uiState.value.pendingPlans.isNotEmpty()) return
        loadJob = viewModelScope.launch { refreshSelectedMessages() }
    }

    private suspend fun refreshPlans(generation: Long, force: Boolean = false) {
        val references = _uiState.value.messages.mapNotNull { message ->
            val id = message.metadata?.get("plan_proposal_id")?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val todoId = message.metadata?.get("todo_id")?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            id to todoId
        }.toMap()
        for ((id, todoId) in references) {
            if (!force && _uiState.value.plans[id]?.status in setOf("rejected", "reverted")) continue
            val result = conversationRepository.getPlan(todoId, id)
            if (generation != selectionGeneration) return
            if (result is ApiResult.Success && result.data.id == id && result.data.todoId == todoId) {
                _uiState.update {
                    val plan = result.data
                    val changeId = plan.changeSetId
                    val changes = when {
                        plan.canUndo == true && changeId != null -> it.planChanges + (id to changeId)
                        plan.canUndo == false || plan.status == "reverted" -> it.planChanges - id
                        else -> it.planChanges // Compatibility with servers predating durable undo metadata.
                    }
                    it.copy(plans = it.plans + (id to plan), planChanges = changes)
                }
            }
        }
    }

    fun planAction(proposalId: String, action: String) {
        val plan = _uiState.value.plans[proposalId] ?: return
        if (proposalId in _uiState.value.pendingPlans) return
        val generation = selectionGeneration
        _uiState.update { it.copy(pendingPlans = it.pendingPlans + proposalId) }
        viewModelScope.launch {
            try {
                val result: ApiResult<*> = when (action) {
                    "apply" -> {
                        if (!plan.canApply) return@launch
                        conversationRepository.applyPlan(plan.todoId, ChatPlanApplyRequest(plan.id, requireNotNull(plan.revision)))
                    }
                    "dismiss" -> conversationRepository.dismissPlan(plan.todoId, plan.id)
                    "undo" -> {
                        val changeId = _uiState.value.planChanges[proposalId] ?: return@launch
                        conversationRepository.undoPlan(changeId)
                    }
                    else -> return@launch
                }
                if (generation != selectionGeneration) return@launch
                if (result is ApiResult.Success) {
                    val applied = result.data as? com.clawchat.android.core.data.model.ChatPlanApplyResult
                    if (applied?.canUndo == true) _uiState.update { it.copy(planChanges = it.planChanges + (proposalId to applied.changeSetId)) }
                    if (action == "undo") _uiState.update { it.copy(planChanges = it.planChanges - proposalId) }
                    refreshPlans(generation, force = true)
                } else if (result is ApiResult.Error) {
                    _uiState.update { it.copy(error = result.message) }
                    refreshPlans(generation, force = true)
                }
            } finally { _uiState.update { it.copy(pendingPlans = it.pendingPlans - proposalId) } }
        }
    }

    private fun disableRunActions() {
        _uiState.update { state -> state.copy(isRunActionPending = true, messages = state.messages.map {
            it.copy(metadata = it.metadata?.let { data -> JsonObject(data + ("actions_live" to JsonPrimitive(false))) })
        }) }
    }

    private suspend fun refreshRunActions(generation: Long) {
        val messages = _uiState.value.messages
        val latest = messages.filter { it.runUpdate?.runId != null }.associateBy { it.runUpdate!!.runId!! }
        val pendingReviews = if (latest.values.any { it.runUpdate?.status == "waiting_review" }) {
            (reviewRepository.listPending() as? ApiResult.Success)?.data?.map { it.id }?.toSet().orEmpty()
        } else emptySet()
        val liveMessages = mutableSetOf<String>()
        for ((runId, message) in latest) {
            val update = message.runUpdate ?: continue
            if (!update.needsUser) continue
            val run = (agentRunRepository.getRun(runId) as? ApiResult.Success)?.data ?: continue
            if (run.conversationId != _uiState.value.selectedConversationId) continue
            if ((update.status == "waiting_input" && run.status == AgentRunStatus.WAITING_INPUT) ||
                (update.status == "waiting_review" && run.status == AgentRunStatus.WAITING_REVIEW && update.reviewId in pendingReviews)) {
                liveMessages += message.id
            }
        }
        if (generation != selectionGeneration) return
        _uiState.update { state -> state.copy(messages = state.messages.map { message ->
            message.copy(metadata = message.metadata?.let { JsonObject(it + ("actions_live" to JsonPrimitive(message.id in liveMessages))) })
        }) }
    }

    fun clearSelection() {
        selectionGeneration++
        loadJob?.cancel()
        streamJob?.cancel()
        streamBuffer.clear()
        _uiState.update { it.copy(selectedConversationId = null, messages = emptyList(), isLoadingMessages = false, isStreaming = false, streamingText = "") }
    }
}
