package com.clawchat.android.core.network

import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import org.json.JSONObject

/** Events emitted by the SSE chat stream. */
sealed interface SseEvent {
    /** Metadata about the stream (conversation ID, message ID). */
    data class Meta(val conversationId: String, val messageId: String) : SseEvent

    /** A text token from the assistant's response. */
    data class Token(val text: String) : SseEvent

    /** The server generated a title for the conversation. */
    data class TitleGenerated(val title: String) : SseEvent

    /** Stream completed successfully. */
    data object Done : SseEvent

    /** An error occurred during streaming. */
    data class Error(val message: String) : SseEvent
}

/**
 * Connects to the ClawChat SSE `/api/chat/stream` endpoint and emits
 * [SseEvent]s as a Kotlin [Flow]. The connection is closed when the
 * flow collector cancels.
 */
fun streamChat(
    client: OkHttpClient,
    baseUrl: String,
    conversationId: String,
    content: String,
    token: String,
): Flow<SseEvent> = callbackFlow {
    val json = JSONObject().apply {
        put("conversation_id", conversationId)
        put("content", content)
    }

    val request = Request.Builder()
        .url("$baseUrl/api/chat/stream")
        .addHeader("Authorization", "Bearer $token")
        .post(json.toString().toRequestBody("application/json".toMediaType()))
        .build()

    val listener = object : EventSourceListener() {
        override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
            when (type) {
                "meta" -> {
                    val obj = JSONObject(data)
                    trySend(SseEvent.Meta(
                        conversationId = obj.optString("conversation_id", ""),
                        messageId = obj.optString("message_id", ""),
                    ))
                }
                "token" -> trySend(SseEvent.Token(data))
                "title_generated" -> trySend(SseEvent.TitleGenerated(data))
                "done", null -> {
                    if (data == "[DONE]" || type == "done") {
                        trySend(SseEvent.Done)
                        close()
                    } else {
                        // Default: treat as token
                        trySend(SseEvent.Token(data))
                    }
                }
                else -> trySend(SseEvent.Token(data))
            }
        }

        override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
            trySend(SseEvent.Error(t?.message ?: "SSE connection failed"))
            close()
        }

        override fun onClosed(eventSource: EventSource) {
            close()
        }
    }

    val factory = EventSources.createFactory(client)
    val eventSource = factory.newEventSource(request, listener)

    awaitClose {
        eventSource.cancel()
    }
}
