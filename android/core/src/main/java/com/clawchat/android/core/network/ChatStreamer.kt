package com.clawchat.android.core.network

import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.di.AuthenticatedClient
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import okhttp3.OkHttpClient
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Opens the assistant stream for one message.
 *
 * The session lookup and the HTTP client live here rather than in the
 * ViewModel, which only cares about the events that come back.
 */
interface ChatStreamer {
    fun stream(conversationId: String, content: String): Flow<SseEvent>
}

@Singleton
class ChatStreamerImpl @Inject constructor(
    @param:AuthenticatedClient private val client: OkHttpClient,
    private val sessionStore: SessionStore,
) : ChatStreamer {

    override fun stream(conversationId: String, content: String): Flow<SseEvent> = flow {
        // The URL and bearer token must come from one active-session snapshot.
        // In local mode activeSession is null even when a server is remembered.
        val session = sessionStore.activeSession.first()
        val baseUrl = session?.apiBaseUrl
        val token = session?.token
        if (baseUrl.isNullOrBlank() || token.isNullOrBlank()) {
            // The caller has already put a streaming indicator on screen, so
            // returning quietly would leave it spinning with no way out.
            emit(SseEvent.Error("Not connected to a server"))
            return@flow
        }
        emitAll(streamChat(client, baseUrl, conversationId, content, token))
    }
}
