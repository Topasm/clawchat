package com.clawchat.android.core.sync

import com.clawchat.android.core.network.SyncEvent
import com.clawchat.android.core.network.WebSocketClient
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
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
class SyncManager @Inject constructor(
    private val webSocketClient: WebSocketClient,
) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val _todoChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val todoChanged: SharedFlow<Unit> = _todoChanged.asSharedFlow()

    private val _eventChanged = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val eventChanged: SharedFlow<Unit> = _eventChanged.asSharedFlow()

    private val _isConnected = MutableStateFlow(false)
    val isConnected: StateFlow<Boolean> = _isConnected.asStateFlow()

    fun start() {
        webSocketClient.connect()
        scope.launch {
            webSocketClient.events.collect { event ->
                when (event) {
                    is SyncEvent.ModuleChanged -> when (event.module) {
                        "todos" -> _todoChanged.tryEmit(Unit)
                        "events" -> _eventChanged.tryEmit(Unit)
                    }
                    is SyncEvent.Connected -> _isConnected.value = true
                    is SyncEvent.Disconnected -> _isConnected.value = false
                }
            }
        }
    }

    fun stop() {
        webSocketClient.disconnect()
        _isConnected.value = false
    }
}
