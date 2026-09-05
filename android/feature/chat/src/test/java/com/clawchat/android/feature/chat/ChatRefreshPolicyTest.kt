package com.clawchat.android.feature.chat

import com.clawchat.android.core.data.model.Message
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.junit.Assert.assertEquals
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ChatRefreshPolicyTest {
    private fun update(id: String, run: String, status: String) = Message(
        id = id, role = "assistant", content = "",
        metadata = buildJsonObject {
            put("action_type", "run_update")
            put("run_id", run)
            put("status", status)
        },
    )

    @Test fun `ordinary conversation polls slowly`() {
        assertEquals(30_000L, ChatUiState().refreshIntervalMillis())
    }

    @Test fun `active runs and user decisions retain fast revalidation`() {
        for (status in listOf("queued", "starting", "running", "waiting_input", "waiting_review")) {
            assertEquals(5_000L, ChatUiState(messages = listOf(update("m1", "r1", status))).refreshIntervalMillis())
        }
    }

    @Test fun `terminal update supersedes old running card`() {
        for (status in listOf("completed", "failed", "cancelled")) {
            val messages = listOf(update("m1", "r1", "running"), update("m2", "r1", status))
            assertEquals(30_000L, ChatUiState(messages = messages).refreshIntervalMillis())
        }
    }

    @Test fun `another active run keeps polling fast`() {
        val messages = listOf(update("m1", "r1", "completed"), update("m2", "r2", "running"))
        assertEquals(5_000L, ChatUiState(messages = messages).refreshIntervalMillis())
    }

    @Test fun `delegated run polls fast until its terminal update`() {
        val delegated = Message(id = "m1", role = "assistant", content = "", metadata = buildJsonObject {
            put("action_type", "task_delegated")
            put("task_id", "t1")
            put("run_id", "r1")
        })
        assertEquals(5_000L, ChatUiState(messages = listOf(delegated)).refreshIntervalMillis())
        val messages = listOf(delegated, update("m2", "r1", "completed"))
        assertEquals(30_000L, ChatUiState(messages = messages).refreshIntervalMillis())
    }

    @Test fun `network error backs off even with a running card`() {
        val state = ChatUiState(messages = listOf(update("m1", "r1", "running")), error = "offline")
        assertEquals(30_000L, state.refreshIntervalMillis())
    }

    @Test fun `polling refreshes on entry and reduces idle requests`() = runTest {
        val state = MutableStateFlow(ChatUiState())
        var requests = 0
        backgroundScope.launch { state.pollConversation { requests++ } }
        runCurrent()
        assertEquals(1, requests)
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(2, requests)
        // Other UI updates must not reset the timer.
        state.value = state.value.copy(streamingText = "partial")
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(3, requests)
    }

    @Test fun `run transitions reschedule polling and cancellation stops it`() = runTest {
        val state = MutableStateFlow(ChatUiState())
        var requests = 0
        val polling = backgroundScope.launch { state.pollConversation { requests++ } }
        runCurrent()
        state.value = ChatUiState(messages = listOf(update("m1", "r1", "running")))
        runCurrent()
        advanceTimeBy(5_000)
        runCurrent()
        assertEquals(2, requests)
        state.value = ChatUiState(messages = listOf(update("m2", "r1", "completed")))
        runCurrent()
        advanceTimeBy(5_000)
        runCurrent()
        assertEquals(2, requests)
        advanceTimeBy(25_000)
        runCurrent()
        assertEquals(3, requests)
        polling.cancel()
        advanceTimeBy(60_000)
        runCurrent()
        assertEquals(3, requests)
    }
}
