package com.clawchat.android.feature.chat

import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.*
import com.clawchat.android.core.data.*
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.io.File
import org.junit.Rule
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class ChatDraftStoreTest {
    @get:Rule val temporary = TemporaryFolder()

    @Test fun `draft survives closing and reopening a real datastore file`() = runTest {
        val file = File(temporary.newFolder(), "drafts.preferences_pb")
        val key = ChatDraftKey("server", "thread")
        val firstJob = SupervisorJob()
        val firstScope = CoroutineScope(firstJob + Dispatchers.IO)
        try {
            val disk = PreferenceDataStoreFactory.create(scope = firstScope, produceFile = { file })
            val store = ChatDraftStore(disk, firstScope)
            store.status.first { it.ready }
            store.edit(key, "논문 초안 계속 작성")
            store.status.first { !it.saving }
            assertFalse(store.status.value.failed)
        } finally { firstJob.cancelAndJoin() }
        val secondJob = SupervisorJob()
        val secondScope = CoroutineScope(secondJob + Dispatchers.IO)
        try {
            val disk = PreferenceDataStoreFactory.create(scope = secondScope, produceFile = { file })
            val store = ChatDraftStore(disk, secondScope)
            store.status.first { it.ready }
            assertEquals("논문 초안 계속 작성", store.drafts.value[key.storageKey])
        } finally { secondJob.cancelAndJoin() }
    }
    private class MemoryDisk : DataStore<Preferences> {
        val state = MutableStateFlow<Preferences>(emptyPreferences())
        var failRead = false
        var failWrite = false
        override val data: Flow<Preferences> get() = flow {
            if (failRead) throw IOException("unavailable")
            emitAll(state)
        }
        override suspend fun updateData(transform: suspend (Preferences) -> Preferences): Preferences {
            if (failWrite) throw IOException("full")
            return transform(state.value).also { state.value = it }
        }
    }

    @Test fun `recreated store restores drafts isolated by workspace and thread`() = runTest {
        val disk = MemoryDisk()
        val store = ChatDraftStore(disk, backgroundScope)
        runCurrent()
        val key = ChatDraftKey("a", "project")
        store.edit(key, "Paper draft")
        store.edit(ChatDraftKey("a", "run"), "Run response")
        runCurrent()
        val reopened = ChatDraftStore(disk, backgroundScope)
        runCurrent()
        assertEquals("Paper draft", reopened.drafts.value[key.storageKey])
        assertNull(reopened.drafts.value[ChatDraftKey("b", "project").storageKey])
        reopened.edit(key, "")
        runCurrent()
        val third = ChatDraftStore(disk, backgroundScope)
        runCurrent()
        assertNull(third.drafts.value[key.storageKey])
        assertEquals("Run response", third.drafts.value[ChatDraftKey("a", "run").storageKey])
    }

    @Test fun `restore failure cannot overwrite existing drafts with an empty snapshot`() = runTest {
        val disk = MemoryDisk().apply { failRead = true }
        val store = ChatDraftStore(disk, backgroundScope)
        runCurrent()
        store.edit(ChatDraftKey("a", "t"), "Too early")
        assertTrue(store.status.value.failed)
        assertTrue(store.drafts.value.isEmpty())
        disk.failRead = false
        store.retry()
        runCurrent()
        assertTrue(store.status.value.ready)
    }

    @Test fun `failed write retains edits and retry persists latest text without removing session preferences`() = runTest {
        val disk = MemoryDisk()
        disk.state.value = preferencesOf(stringPreferencesKey("session") to "keep")
        val store = ChatDraftStore(disk, backgroundScope)
        runCurrent()
        disk.failWrite = true
        val key = ChatDraftKey("a", "t")
        store.edit(key, "First")
        store.edit(key, "Latest")
        runCurrent()
        assertTrue(store.status.value.failed)
        assertEquals("Latest", store.drafts.value[key.storageKey])
        disk.failWrite = false
        store.retry()
        runCurrent()
        assertFalse(store.status.value.failed)
        assertFalse(store.status.value.saving)
        assertEquals("keep", disk.state.value[stringPreferencesKey("session")])
        val reopened = ChatDraftStore(disk, backgroundScope)
        runCurrent()
        assertEquals("Latest", reopened.drafts.value[key.storageKey])
    }

    @Test fun `workspace switch rejects stale callbacks`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val runtime = MutableStateFlow(AppRuntimeState(WorkspaceMode.SERVER,
                ActiveSession("token", null, null, null), true, "a"))
            val sessions = mockk<SessionStore>()
            every { sessions.runtimeState } returns runtime
            val store = ChatDraftStore(MemoryDisk(), backgroundScope)
            val vm = ChatDraftViewModel(sessions, store)
            runCurrent()
            vm.edit("a", "t", "Draft")
            runtime.value = runtime.value.copy(workspaceKey = "b")
            runCurrent()
            vm.edit("a", "t", "Late callback")
            assertEquals("Draft", store.drafts.value[ChatDraftKey("a", "t").storageKey])
            assertNull(store.drafts.value[ChatDraftKey("b", "t").storageKey])
        } finally { Dispatchers.resetMain() }
    }
}
