package com.clawchat.android.core.network

import android.util.Log
import com.clawchat.android.core.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import javax.inject.Inject
import javax.inject.Singleton

/** Events emitted by the real-time sync WebSocket. */
sealed interface SyncEvent {
    /** WebSocket connection established. */
    data object Connected : SyncEvent

    /** WebSocket connection lost. */
    data object Disconnected : SyncEvent

    /** A server-side module changed (e.g. todos, events, conversations). */
    data class ModuleChanged(val module: String) : SyncEvent

    /** A reminder notification from the server. */
    data class Reminder(
        val reminderType: String,
        val itemId: String,
        val title: String,
        val message: String,
        val minutesUntil: Int,
    ) : SyncEvent

    /** A nudge notification from the server. */
    data class Nudge(
        val title: String,
        val message: String,
        val todoId: String?,
    ) : SyncEvent

    /** A weekly review summary from the server. */
    data class WeeklyReview(val content: String) : SyncEvent
}

/**
 * WebSocket client for real-time sync with the ClawChat backend.
 *
 * Connects to `ws://<baseUrl>/ws?token=<jwt>`, auto-reconnects with
 * exponential backoff, and sends periodic keepalive pings. Emits
 * [SyncEvent]s via a [SharedFlow] so that repositories and ViewModels
 * can react to server-side changes.
 */
@Singleton
class WebSocketClient @Inject constructor(
    private val sessionStore: SessionStore,
) {
    companion object {
        private const val TAG = "WebSocketClient"
        private const val PING_INTERVAL_MS = 20_000L
        private const val INITIAL_BACKOFF_MS = 1_000L
        private const val MAX_BACKOFF_MS = 30_000L
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val client = OkHttpClient()

    private val _events = MutableSharedFlow<SyncEvent>(extraBufferCapacity = 64)
    /** Stream of real-time sync events. */
    val events: SharedFlow<SyncEvent> = _events.asSharedFlow()

    private var webSocket: WebSocket? = null
    private var pingJob: Job? = null
    private var reconnectJob: Job? = null
    private var currentBackoff = INITIAL_BACKOFF_MS
    private var shouldReconnect = false

    /**
     * Opens the WebSocket connection. Reads the current token and base URL
     * from [SessionStore]. If either is missing the connect is skipped.
     */
    fun connect() {
        scope.launch {
            val token = sessionStore.token.first()
            val baseUrl = sessionStore.apiBaseUrl.first()

            if (token.isNullOrBlank() || baseUrl.isNullOrBlank()) {
                Log.w(TAG, "Cannot connect: token or baseUrl is null")
                return@launch
            }

            shouldReconnect = true
            openConnection(baseUrl, token)
        }
    }

    /** Closes the WebSocket and stops all reconnect / keepalive jobs. */
    fun disconnect() {
        shouldReconnect = false
        reconnectJob?.cancel()
        reconnectJob = null
        pingJob?.cancel()
        pingJob = null
        webSocket?.close(1000, "Client disconnect")
        webSocket = null
        Log.d(TAG, "Disconnected")
    }

    // ---- internal --------------------------------------------------------

    private fun openConnection(baseUrl: String, token: String) {
        // Convert http(s):// to ws(s)://
        val wsUrl = baseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
            .trimEnd('/')

        val url = "$wsUrl/ws?token=$token"
        Log.d(TAG, "Connecting to $wsUrl/ws")

        val request = Request.Builder().url(url).build()
        webSocket = client.newWebSocket(request, Listener(baseUrl, token))
    }

    private fun scheduleReconnect(baseUrl: String, token: String) {
        if (!shouldReconnect) return

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            Log.d(TAG, "Reconnecting in ${currentBackoff}ms")
            delay(currentBackoff)
            currentBackoff = (currentBackoff * 2).coerceAtMost(MAX_BACKOFF_MS)
            openConnection(baseUrl, token)
        }
    }

    private fun startPing(ws: WebSocket) {
        pingJob?.cancel()
        pingJob = scope.launch {
            while (true) {
                delay(PING_INTERVAL_MS)
                val sent = ws.send("""{"type":"ping"}""")
                if (!sent) {
                    Log.d(TAG, "Ping send failed, stopping keepalive")
                    break
                }
            }
        }
    }

    private fun handleMessage(text: String) {
        try {
            val json = JSONObject(text)
            when (val type = json.optString("type")) {
                "pong", "heartbeat" -> {
                    // Ignore keepalive responses
                }
                "module_data_changed" -> {
                    val module = json.optJSONObject("data")?.optString("module") ?: return
                    Log.d(TAG, "Module changed: $module")
                    _events.tryEmit(SyncEvent.ModuleChanged(module))
                }
                "reminder" -> {
                    val data = json.optJSONObject("data") ?: return
                    val reminderType = data.optString("reminder_type", "")
                    val itemId = data.optString("item_id", "")
                    val title = data.optString("title", "")
                    val message = data.optString("message", "")
                    val minutesUntil = data.optInt("minutes_until", 0)
                    Log.d(TAG, "Reminder: $title ($reminderType)")
                    _events.tryEmit(
                        SyncEvent.Reminder(reminderType, itemId, title, message, minutesUntil)
                    )
                }
                "nudge" -> {
                    val data = json.optJSONObject("data") ?: return
                    val title = data.optString("title", "")
                    val message = data.optString("message", "")
                    val todoId: String? = if (data.has("todo_id")) data.optString("todo_id") else null
                    Log.d(TAG, "Nudge: $title")
                    _events.tryEmit(SyncEvent.Nudge(title, message, todoId))
                }
                "weekly_review" -> {
                    val data = json.optJSONObject("data") ?: return
                    val content = data.optString("content", "")
                    Log.d(TAG, "Weekly review received")
                    _events.tryEmit(SyncEvent.WeeklyReview(content))
                }
                else -> {
                    Log.d(TAG, "Unhandled message type: $type")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse message: $text", e)
        }
    }

    // ---- WebSocket listener ---------------------------------------------

    private inner class Listener(
        private val baseUrl: String,
        private val token: String,
    ) : WebSocketListener() {

        override fun onOpen(webSocket: WebSocket, response: Response) {
            Log.d(TAG, "Connected")
            currentBackoff = INITIAL_BACKOFF_MS
            _events.tryEmit(SyncEvent.Connected)
            startPing(webSocket)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            handleMessage(text)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            Log.d(TAG, "Server closing: $code $reason")
            webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            Log.d(TAG, "Closed: $code $reason")
            pingJob?.cancel()
            _events.tryEmit(SyncEvent.Disconnected)
            scheduleReconnect(baseUrl, token)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            Log.w(TAG, "Connection failure: ${t.message}")
            pingJob?.cancel()
            _events.tryEmit(SyncEvent.Disconnected)
            scheduleReconnect(baseUrl, token)
        }
    }
}
