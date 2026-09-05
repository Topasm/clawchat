package com.clawchat.android.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton

internal data class ChatDraftKey(val workspace: String, val conversation: String) {
    val storageKey: String get() = MessageDigest.getInstance("SHA-256")
        .digest("${workspace.length}:$workspace$conversation".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }
}

internal data class DraftStorageState(val ready: Boolean = false, val saving: Boolean = false, val failed: Boolean = false)

/** Serialized, app-lifetime writes continue even after the conversation screen closes. */
@Singleton
class ChatDraftStore internal constructor(
    private val dataStore: DataStore<Preferences>,
    private val scope: CoroutineScope,
) {
    @Inject constructor(dataStore: DataStore<Preferences>) : this(dataStore, CoroutineScope(SupervisorJob() + Dispatchers.IO))
    private val prefix = "chat_draft_v1_"
    private val values = MutableStateFlow<Map<String, String>>(emptyMap())
    internal val drafts = values.asStateFlow()
    private val storage = MutableStateFlow(DraftStorageState())
    internal val status = storage.asStateFlow()
    private val writes = Channel<Unit>(Channel.CONFLATED)
    private var restore: Job? = null

    init {
        retry()
        scope.launch {
            for (ignored in writes) {
                val snapshot = values.value
                try {
                    dataStore.edit { prefs ->
                        prefs.asMap().keys.filter { it.name.startsWith(prefix) }.forEach { prefs.remove(it) }
                        snapshot.forEach { (key, text) -> prefs[stringPreferencesKey(prefix + key)] = text }
                    }
                    storage.update { it.copy(saving = values.value != snapshot, failed = false) }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { storage.update { it.copy(saving = false, failed = true) } }
            }
        }
    }

    internal fun retry() {
        if (storage.value.ready) {
            storage.update { it.copy(saving = true, failed = false) }
            writes.trySend(Unit)
        } else if (restore?.isActive != true) {
            storage.value = DraftStorageState()
            restore = scope.launch {
                try {
                    values.value = dataStore.data.first().asMap().mapNotNull { (key, value) ->
                        if (key.name.startsWith(prefix) && value is String) key.name.removePrefix(prefix) to value else null
                    }.toMap()
                    storage.value = DraftStorageState(ready = true)
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { storage.value = DraftStorageState(failed = true) }
            }
        }
    }

    internal fun edit(key: ChatDraftKey, text: String) {
        if (!storage.value.ready) return
        val id = key.storageKey
        values.update { if (text.isEmpty()) it - id else it + (id to text) }
        storage.update { it.copy(saving = true, failed = false) }
        writes.trySend(Unit)
    }
}

@HiltViewModel
class ChatDraftViewModel @Inject constructor(
    sessions: SessionStore,
    private val store: ChatDraftStore,
) : ViewModel() {
    val workspace = sessions.runtimeState.map {
        it.workspaceKey.takeIf { _ -> it.mode == WorkspaceMode.SERVER && it.activeSession != null }
    }.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    internal val drafts = store.drafts
    internal val storage = store.status
    fun retry() = store.retry()

    fun edit(owner: String?, conversation: String, text: String) {
        if (owner != null && owner == workspace.value) store.edit(ChatDraftKey(owner, conversation), text)
    }
}
