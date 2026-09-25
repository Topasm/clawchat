package com.clawchat.android.feature.runs

import com.clawchat.android.core.data.repository.CliSessionRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.*
import io.mockk.*
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class CliSessionsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val api = mockk<CliSessionRepository>()
    private val store = mockk<SessionStore>()
    private val runtime = MutableStateFlow(AppRuntimeState(WorkspaceMode.SERVER, null, true, "host-a"))
    private val codex = CliSession("same", "codex", "Code", status = "running", kind = "interactive", canSend = true)
    private val claude = CliSession("same", "claude", "Review", status = "running", kind = "background", canStop = true)

    @Before fun setup() {
        Dispatchers.setMain(dispatcher)
        every { store.runtimeState } returns runtime
        coEvery { api.list(any()) } returns ApiResult.Success(CliSessionList(listOf(codex, claude), emptyList()))
    }
    @After fun tearDown() { Dispatchers.resetMain() }

    @Test fun `controls preserve provider even when session ids match`() = runTest(dispatcher) {
        coEvery { api.detail("host-a", "claude", "same") } returns ApiResult.Success(CliSessionDetail(claude, "recent output"))
        coEvery { api.act(any(), any(), any(), any()) } returns ApiResult.Success(CliSessionActionResult(true))
        val model = CliSessionsViewModel(api, store)
        advanceUntilIdle()
        model.select(claude)
        advanceUntilIdle()
        model.act(claude, "stop")
        advanceUntilIdle()
        coVerify(exactly = 1) { api.act("host-a", "claude", "same", CliSessionAction("stop")) }
        assertTrue(model.state.value.accepted)
        assertEquals("recent output", model.state.value.detail?.output)
    }

    @Test fun `workspace change clears selected session and pending details`() = runTest(dispatcher) {
        val pending = CompletableDeferred<CliSessionDetail>()
        coEvery { api.detail(any(), any(), any()) } coAnswers { ApiResult.Success(pending.await()) }
        val model = CliSessionsViewModel(api, store)
        runCurrent()
        model.select(codex)
        runCurrent()
        coEvery { api.list(any()) } returns ApiResult.Success(CliSessionList(emptyList(), emptyList()))
        runtime.value = runtime.value.copy(workspaceKey = "host-b")
        runCurrent()
        pending.complete(CliSessionDetail(codex, "host-a output"))
        advanceUntilIdle()
        assertNull(model.state.value.selected)
        assertNull(model.state.value.detail)
        assertTrue(model.state.value.listing!!.sessions.isEmpty())
    }

    @Test fun `duplicate taps do not send the same control twice`() = runTest(dispatcher) {
        val pending = CompletableDeferred<CliSessionActionResult>()
        coEvery { api.act(any(), any(), any(), any()) } coAnswers { ApiResult.Success(pending.await()) }
        val model = CliSessionsViewModel(api, store)
        runCurrent()
        model.act(claude, "stop")
        model.act(claude, "stop")
        runCurrent()
        coVerify(exactly = 1) { api.act(any(), any(), any(), any()) }
        pending.complete(CliSessionActionResult(true))
        advanceUntilIdle()
        assertFalse(model.state.value.busy)
    }
}
