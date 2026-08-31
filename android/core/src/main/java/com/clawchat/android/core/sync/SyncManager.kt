package com.clawchat.android.core.sync

import com.clawchat.android.core.data.ActiveSession
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

/** A realtime payload pinned to the workspace connection that produced it. */
data class WorkspaceSyncEvent<out T>(
    val workspaceKey: String,
    val payload: T,
)

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

    /** Identity of the connection currently owned by this process singleton. */
    private var activeWorkspaceKey: String? = null
    private var activeSessionIdentity: ActiveSession? = null

    private val _todoChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val todoChanged: SharedFlow<Unit> = _todoChanged.asSharedFlow()

    private val _eventChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val eventChanged: SharedFlow<Unit> = _eventChanged.asSharedFlow()

    private val _reviewChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val reviewChanged: SharedFlow<Unit> = _reviewChanged.asSharedFlow()

    private val _runChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val runChanged: SharedFlow<Unit> = _runChanged.asSharedFlow()

    private val _reminder = MutableSharedFlow<WorkspaceSyncEvent<SyncEvent.Reminder>>(
        extraBufferCapacity = 16,
    )
    val reminder: SharedFlow<WorkspaceSyncEvent<SyncEvent.Reminder>> = _reminder.asSharedFlow()

    private val _nudge = MutableSharedFlow<WorkspaceSyncEvent<SyncEvent.Nudge>>(
        extraBufferCapacity = 16,
    )
    val nudge: SharedFlow<WorkspaceSyncEvent<SyncEvent.Nudge>> = _nudge.asSharedFlow()

    private val _weeklyReview = MutableSharedFlow<WorkspaceSyncEvent<SyncEvent.WeeklyReview>>(
        extraBufferCapacity = 16,
    )
    val weeklyReview: SharedFlow<WorkspaceSyncEvent<SyncEvent.WeeklyReview>> =
        _weeklyReview.asSharedFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    /** Wall-clock time of the latest accepted realtime event for diagnostics. */
    private val _lastEventAtEpochMillis = MutableStateFlow<Long?>(null)
    val lastEventAtEpochMillis: StateFlow<Long?> = _lastEventAtEpochMillis.asStateFlow()

    /** Non-sensitive summary of the latest realtime failure, cleared on reconnect. */
    private val _lastConnectionError = MutableStateFlow<String?>(null)
    val lastConnectionError: StateFlow<String?> = _lastConnectionError.asStateFlow()

    /**
     * Reconciles realtime ownership with the active workspace. Activity
     * recreation is intentionally a no-op when the process singleton already
     * owns the same connection.
     */
    fun reconcile(workspaceKey: String?, sessionIdentity: ActiveSession? = null) {
        synchronized(lifecycleLock) {
            val normalizedKey = workspaceKey?.takeIf(String::isNotBlank)
            if (
                normalizedKey != null &&
                activeWorkspaceKey == normalizedKey &&
                activeSessionIdentity == sessionIdentity &&
                eventJob?.isActive == true
            ) {
                return
            }

            if (eventJob != null || activeWorkspaceKey != null) {
                stopLocked()
            }
            if (normalizedKey == null) return

            val generation = ++sessionGeneration
            activeWorkspaceKey = normalizedKey
            activeSessionIdentity = sessionIdentity
            _isConnected.value = false
            _lastEventAtEpochMillis.value = null
            _lastConnectionError.value = null

            // Register the collector before connect() can emit Connected. The
            // undispatched start only runs until SharedFlow suspends waiting.
            eventJob = scope.launch(start = CoroutineStart.UNDISPATCHED) {
                webSocketClient.events.collect { event ->
                    handleEvent(generation, normalizedKey, event)
                }
            }

            webSocketClient.connect()
        }
    }

    /** Compatibility entry point for tests and callers without session state. */
    fun start() = reconcile(UNSCOPED_WORKSPACE_KEY)

    fun stop() {
        synchronized(lifecycleLock) {
            stopLocked()
        }
    }

    private fun stopLocked() {
        sessionGeneration++
        activeWorkspaceKey = null
        activeSessionIdentity = null
        eventJob?.cancel()
        eventJob = null
        _isConnected.value = false
        _lastEventAtEpochMillis.value = null
        _lastConnectionError.value = null
        webSocketClient.disconnect()
    }

    private fun handleEvent(generation: Long, workspaceKey: String, event: SyncEvent) {
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
                    _reminder.tryEmit(WorkspaceSyncEvent(workspaceKey, event))
                }
                is SyncEvent.Nudge -> {
                    _lastEventAtEpochMillis.value = System.currentTimeMillis()
                    _nudge.tryEmit(WorkspaceSyncEvent(workspaceKey, event))
                }
                is SyncEvent.WeeklyReview -> {
                    _lastEventAtEpochMillis.value = System.currentTimeMillis()
                    _weeklyReview.tryEmit(WorkspaceSyncEvent(workspaceKey, event))
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

    private companion object {
        const val UNSCOPED_WORKSPACE_KEY = "legacy"
    }
}
