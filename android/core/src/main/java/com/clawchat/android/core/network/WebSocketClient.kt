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
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicLong
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
        val deliveryKey: String? = null,
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
 * Exchanges the bearer token for a short-lived WebSocket ticket, then connects
 * to `ws://<baseUrl>/ws?ticket=<ticket>`. Auto-reconnects with
 * exponential backoff, and sends periodic keepalive pings. Emits
 * [SyncEvent]s via a [SharedFlow] so that repositories and ViewModels
 * can react to server-side changes.
 */
@Singleton
class WebSocketClient @Inject constructor(
    private val sessionStore: SessionStore,
    private val relayClient: RelayClient,
    private val sessionRefresher: SessionRefresher,
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
    private var ticketJob: Job? = null
    @Volatile private var ticketCall: Call? = null
    private var currentBackoff = INITIAL_BACKOFF_MS
    @Volatile private var shouldReconnect = false
    private val connectionGeneration = AtomicLong(0)

    init {
        scope.launch {
            relayClient.events.collect { message ->
                when {
                    message.contains("\"type\":\"relay_disconnected\"") -> {
                        _events.tryEmit(SyncEvent.Disconnected)
                        if (shouldReconnect) connect()
                    }
                    message.contains("\"type\":\"auth_error\"") ->
                        handleAuthenticationFailure(connectionGeneration.get())
                    else -> handleMessage(message)
                }
            }
        }
    }

    /**
     * Opens the WebSocket connection from one atomic active-session snapshot.
     * Saved credentials are deliberately invisible while local mode is active.
     */
    fun connect() {
        val generation = connectionGeneration.incrementAndGet()
        shouldReconnect = true
        reconnectJob?.cancel()
        reconnectJob = null
        ticketJob?.cancel()
        ticketJob = null
        ticketCall?.cancel()
        ticketCall = null
        pingJob?.cancel()
        pingJob = null
        webSocket?.close(1000, "Reconnecting")
        webSocket = null
        currentBackoff = INITIAL_BACKOFF_MS

        scope.launch {
            val session = sessionStore.activeSession.first()
            val token = session?.token
            val baseUrl = session?.apiBaseUrl

            if (!isCurrent(generation)) return@launch
            if (token.isNullOrBlank() || baseUrl.isNullOrBlank()) {
                Log.w(TAG, "Cannot connect: token or baseUrl is null")
                shouldReconnect = false
                return@launch
            }

            openConnection(baseUrl, token, generation)
        }
    }

    /** Closes the WebSocket and stops all reconnect / keepalive jobs. */
    fun disconnect() {
        shouldReconnect = false
        connectionGeneration.incrementAndGet()
        reconnectJob?.cancel()
        reconnectJob = null
        ticketJob?.cancel()
        ticketJob = null
        ticketCall?.cancel()
        ticketCall = null
        pingJob?.cancel()
        pingJob = null
        webSocket?.close(1000, "Client disconnect")
        webSocket = null
        scope.launch { relayClient.unsubscribe() }
        Log.d(TAG, "Disconnected")
    }

    // ---- internal --------------------------------------------------------

    private fun openConnection(baseUrl: String, token: String, generation: Long) {
        if (!isCurrent(generation)) return
        ticketJob?.cancel()
        ticketCall?.cancel()
        ticketJob = scope.launch {
            when (val result = requestTicket(baseUrl, token)) {
                is TicketResult.Success -> {
                    if (isCurrent(generation)) {
                        openConnectionWithTicket(baseUrl, token, result.ticket, generation)
                    }
                }
                TicketResult.Unauthorized -> handleAuthenticationFailure(generation, token)
                TicketResult.RetryableFailure -> {
                    if (!isCurrent(generation)) return@launch
                    if (relayClient.subscribe(token) && isCurrent(generation)) {
                        Log.d(TAG, "Connected through E2EE relay")
                        currentBackoff = INITIAL_BACKOFF_MS
                        _events.tryEmit(SyncEvent.Connected)
                        return@launch
                    }
                    if (!isCurrent(generation)) return@launch
                    Log.w(TAG, "Failed to obtain WebSocket ticket or relay connection")
                    scheduleReconnect(baseUrl, token, generation)
                }
            }
        }
    }

    private fun requestTicket(baseUrl: String, token: String): TicketResult {
        val url = "${baseUrl.trimEnd('/')}/api/auth/ws-ticket"
        val request = Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .post(ByteArray(0).toRequestBody(null))
            .build()
        val call = client.newCall(request)
        ticketCall = call
        return try {
            call.execute().use { response ->
                if (response.code == 401 || response.code == 403) {
                    return TicketResult.Unauthorized
                }
                if (!response.isSuccessful) return TicketResult.RetryableFailure
                val body = response.body.string()
                JSONObject(body).optString("ticket")
                    .takeIf { it.isNotBlank() }
                    ?.let { TicketResult.Success(it) }
                    ?: TicketResult.RetryableFailure
            }
        } catch (e: Exception) {
            if (!call.isCanceled()) {
                Log.w(TAG, "WebSocket ticket request failed (${e.javaClass.simpleName})")
            }
            TicketResult.RetryableFailure
        } finally {
            if (ticketCall === call) ticketCall = null
        }
    }

    private fun openConnectionWithTicket(
        baseUrl: String,
        token: String,
        ticket: String,
        generation: Long,
    ) {
        if (!isCurrent(generation)) return
        scope.launch { relayClient.unsubscribe() }
        // Convert http(s):// to ws(s)://
        val wsUrl = baseUrl
            .replaceFirst("https://", "wss://")
            .replaceFirst("http://", "ws://")
            .trimEnd('/')

        val url = "$wsUrl/ws?ticket=$ticket"
        Log.d(TAG, "Connecting to realtime endpoint")

        val request = Request.Builder().url(url).build()
        val newWebSocket = client.newWebSocket(request, Listener(baseUrl, token, generation))
        if (isCurrent(generation)) {
            webSocket = newWebSocket
        } else {
            newWebSocket.close(1000, "Stale connection")
        }
    }

    private fun scheduleReconnect(baseUrl: String, token: String, generation: Long) {
        if (!isCurrent(generation)) return

        reconnectJob?.cancel()
        reconnectJob = scope.launch {
            Log.d(TAG, "Reconnecting in ${currentBackoff}ms")
            delay(currentBackoff)
            if (!isCurrent(generation)) return@launch
            currentBackoff = (currentBackoff * 2).coerceAtMost(MAX_BACKOFF_MS)
            openConnection(baseUrl, token, generation)
        }
    }

    private fun isCurrent(generation: Long): Boolean =
        shouldReconnect && connectionGeneration.get() == generation

    private suspend fun handleAuthenticationFailure(
        generation: Long,
        rejectedAccessToken: String? = null,
    ) {
        if (!isCurrent(generation)) return
        val refreshedToken = sessionRefresher.refreshAfterUnauthorized(rejectedAccessToken)
        if (!refreshedToken.isNullOrBlank() && isCurrent(generation)) {
            Log.d(TAG, "Restored remembered session after authentication failure")
            connect()
            return
        }
        Log.w(TAG, "Authentication failed; reconnect disabled until a new session is available")
        shouldReconnect = false
        connectionGeneration.incrementAndGet()
        reconnectJob?.cancel()
        reconnectJob = null
        ticketCall?.cancel()
        ticketCall = null
        pingJob?.cancel()
        pingJob = null
        webSocket?.close(1000, "Authentication failed")
        webSocket = null
        relayClient.unsubscribe()
        sessionStore.clearSession()
        _events.tryEmit(SyncEvent.Disconnected)
    }

    private sealed interface TicketResult {
        data class Success(val ticket: String) : TicketResult
        data object Unauthorized : TicketResult
        data object RetryableFailure : TicketResult
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
                    val deliveryKey = data.optString("delivery_key")
                        .takeIf(String::isNotBlank)
                    Log.d(TAG, "Reminder received ($reminderType)")
                    _events.tryEmit(
                        SyncEvent.Reminder(
                            reminderType,
                            itemId,
                            title,
                            message,
                            minutesUntil,
                            deliveryKey,
                        )
                    )
                }
                "nudge" -> {
                    val data = json.optJSONObject("data") ?: return
                    val title = data.optString("title", "")
                    val message = data.optString("message", "")
                    val todoId: String? = if (data.has("todo_id")) data.optString("todo_id") else null
                    Log.d(TAG, "Nudge received")
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
            // Realtime payloads can contain private task titles, notes, and
            // reminder text. Exception messages can echo malformed input too.
            Log.w(TAG, "Failed to parse realtime message (${e.javaClass.simpleName})")
        }
    }

    // ---- WebSocket listener ---------------------------------------------

    private inner class Listener(
        private val baseUrl: String,
        private val token: String,
        private val generation: Long,
    ) : WebSocketListener() {

        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!isCurrent(generation) || this@WebSocketClient.webSocket !== webSocket) {
                webSocket.close(1000, "Stale connection")
                return
            }
            Log.d(TAG, "Connected")
            currentBackoff = INITIAL_BACKOFF_MS
            _events.tryEmit(SyncEvent.Connected)
            startPing(webSocket)
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!isCurrent(generation) || this@WebSocketClient.webSocket !== webSocket) return
            handleMessage(text)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            Log.d(TAG, "Server closing: code=$code")
            webSocket.close(code, reason)
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
            if (!isCurrent(generation) || this@WebSocketClient.webSocket !== webSocket) return
            Log.d(TAG, "Closed: code=$code")
            this@WebSocketClient.webSocket = null
            pingJob?.cancel()
            _events.tryEmit(SyncEvent.Disconnected)
            scheduleReconnect(baseUrl, token, generation)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (!isCurrent(generation) || this@WebSocketClient.webSocket !== webSocket) return
            Log.w(TAG, "Connection failure (${t.javaClass.simpleName})")
            this@WebSocketClient.webSocket = null
            pingJob?.cancel()
            _events.tryEmit(SyncEvent.Disconnected)
            scheduleReconnect(baseUrl, token, generation)
        }
    }
}
