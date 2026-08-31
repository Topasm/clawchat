package com.clawchat.android.core.sync

import com.clawchat.android.core.network.SyncEvent
import com.clawchat.android.core.network.WebSocketClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SyncManager internal constructor(
    private val webSocketClient: WebSocketClient,
    private val scope: CoroutineScope,
) {

    @Inject
    constructor(webSocketClient: WebSocketClient) : this(
        webSocketClient = webSocketClient,
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
    )

    /** Serializes session transitions so concurrent start/stop calls are linearizable. */
    private val lifecycleLock = Any()

    /** The collector belongs to the current login session; the root scope stays process-lived. */
    private var eventJob: Job? = null

    /** Invalidates an event that was queued just before its session stopped. */
    private var sessionGeneration = 0L

    private val _todoChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val todoChanged: SharedFlow<Unit> = _todoChanged.asSharedFlow()

    private val _eventChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val eventChanged: SharedFlow<Unit> = _eventChanged.asSharedFlow()

    private val _reviewChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val reviewChanged: SharedFlow<Unit> = _reviewChanged.asSharedFlow()

    private val _runChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val runChanged: SharedFlow<Unit> = _runChanged.asSharedFlow()

    private val _reminder = MutableSharedFlow<SyncEvent.Reminder>(extraBufferCapacity = 16)
    val reminder: SharedFlow<SyncEvent.Reminder> = _reminder.asSharedFlow()

    private val _nudge = MutableSharedFlow<SyncEvent.Nudge>(extraBufferCapacity = 16)
    val nudge: SharedFlow<SyncEvent.Nudge> = _nudge.asSharedFlow()

    private val _weeklyReview = MutableSharedFlow<SyncEvent.WeeklyReview>(extraBufferCapacity = 16)
    val weeklyReview: SharedFlow<SyncEvent.WeeklyReview> = _weeklyReview.asSharedFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    /** Wall-clock time of the latest accepted realtime event for diagnostics. */
    private val _lastEventAtEpochMillis = MutableStateFlow<Long?>(null)
    val lastEventAtEpochMillis: StateFlow<Long?> = _lastEventAtEpochMillis.asStateFlow()

    /** Non-sensitive summary of the latest realtime failure, cleared on reconnect. */
    private val _lastConnectionError = MutableStateFlow<String?>(null)
    val lastConnectionError: StateFlow<String?> = _lastConnectionError.asStateFlow()

    fun start() {
        synchronized(lifecycleLock) {
            if (eventJob?.isActive == true) return

            val generation = ++sessionGeneration
            _isConnected.value = false
            _lastEventAtEpochMillis.value = null
            _lastConnectionError.value = null

            // Register the collector before connect() can emit Connected. The
            // undispatched start only runs until SharedFlow suspends waiting.
            eventJob = scope.launch(start = CoroutineStart.UNDISPATCHED) {
                webSocketClient.events.collect { event ->
                    handleEvent(generation, event)
                }
            }

            webSocketClient.connect()
        }
    }

    fun stop() {
        synchronized(lifecycleLock) {
            sessionGeneration++
            eventJob?.cancel()
            eventJob = null
            _isConnected.value = false
            _lastEventAtEpochMillis.value = null
            _lastConnectionError.value = null
            webSocketClient.disconnect()
        }
    }

    private fun handleEvent(generation: Long, event: SyncEvent) {
        synchronized(lifecycleLock) {
            // Cancellation is cooperative: an event may already be queued when
            // stop() runs. Never let that stale event mutate the next session.
            if (generation != sessionGeneration) return

            when (event) {
                is SyncEvent.ModuleChanged -> {
                    _lastEventAtEpochMillis.value = System.currentTimeMillis()
                    when (event.module) {
                        "todos" -> _todoChanged.tryEmit(Unit)
                        "events" -> _eventChanged.tryEmit(Unit)
                        "reviews" -> _reviewChanged.tryEmit(Unit)
                        "runs" -> _runChanged.tryEmit(Unit)
                    }
                }
                is SyncEvent.Reminder -> {
                    _lastEventAtEpochMillis.value = System.currentTimeMillis()
                    _reminder.tryEmit(event)
                }
                is SyncEvent.Nudge -> {
                    _lastEventAtEpochMillis.value = System.currentTimeMillis()
                    _nudge.tryEmit(event)
                }
                is SyncEvent.WeeklyReview -> {
                    _lastEventAtEpochMillis.value = System.currentTimeMillis()
                    _weeklyReview.tryEmit(event)
                }
                is SyncEvent.Connected -> {
                    _isConnected.value = true
                    _lastEventAtEpochMillis.value = System.currentTimeMillis()
                    _lastConnectionError.value = null
                    // Repositories refetch authoritative state after a
                    // direct or relay reconnect to recover missed events.
                    _todoChanged.tryEmit(Unit)
                    _eventChanged.tryEmit(Unit)
                    _reviewChanged.tryEmit(Unit)
                    _runChanged.tryEmit(Unit)
                }
                is SyncEvent.Disconnected -> {
                    _isConnected.value = false
                    _lastConnectionError.value = "Realtime connection closed"
                }
            }
        }
    }
}
