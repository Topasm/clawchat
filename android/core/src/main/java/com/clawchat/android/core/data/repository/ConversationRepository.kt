package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.model.Conversation
import com.clawchat.android.core.data.model.Message
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.apiCall
import javax.inject.Inject
import javax.inject.Singleton

interface ConversationRepository {
    suspend fun listConversations(params: Map<String, String> = emptyMap()): ApiResult<PaginatedResponse<Conversation>>
    suspend fun createConversation(body: Map<String, String>): ApiResult<Conversation>
    suspend fun getConversation(id: String): ApiResult<Conversation>
    suspend fun getMessages(conversationId: String): ApiResult<PaginatedResponse<Message>>
    suspend fun deleteConversation(id: String): ApiResult<Unit>
}

@Singleton
class ConversationRepositoryImpl @Inject constructor(
    private val api: ClawChatApi,
) : ConversationRepository {

    override suspend fun listConversations(params: Map<String, String>): ApiResult<PaginatedResponse<Conversation>> =
        apiCall { api.listConversations(params) }

    override suspend fun createConversation(body: Map<String, String>): ApiResult<Conversation> =
        apiCall { api.createConversation(body) }

    override suspend fun getConversation(id: String): ApiResult<Conversation> =
        apiCall { api.getConversation(id) }

    override suspend fun getMessages(conversationId: String): ApiResult<PaginatedResponse<Message>> =
        apiCall { api.getMessages(conversationId) }

    override suspend fun deleteConversation(id: String): ApiResult<Unit> =
        apiCall { api.deleteConversation(id) }
}
