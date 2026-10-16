package com.clawchat.android.feature.inbox

import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.InboxPlacementRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.network.ExpectedSessionScope
import com.clawchat.android.core.sync.SyncManager
import io.mockk.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class InboxCaptureViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val repository = mockk<InboxPlacementRepository>()
    private val sync = mockk<SyncManager>(relaxed = true)
    private val scope = ExpectedSessionScope("server-a")
    private val scopes = MutableStateFlow<ExpectedSessionScope?>(scope)

    @Before fun setup() {
        Dispatchers.setMain(dispatcher)
        every { repository.scopes } returns scopes
    }
    @After fun teardown() { Dispatchers.resetMain() }

    private fun loaded(): InboxCaptureViewModel {
        val vm = InboxCaptureViewModel(repository, sync)
        dispatcher.scheduler.advanceUntilIdle()
        return vm
    }

    @Test fun `capture saves raw input once and retains operation identity across retry`() = runTest {
        val calls = mutableListOf<String>()
        val timestamps = mutableListOf<String>()
        coEvery { repository.capture(scope, "금요일까지 논문 초안 작성", capture(calls), capture(timestamps)) } returns ApiResult.Error("offline")
        val vm = loaded()
        assertTrue(vm.uiState.value.server)
        vm.editCapture("금요일까지 논문 초안 작성")
        vm.capture()
        vm.capture()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(1, calls.size)
        assertEquals("금요일까지 논문 초안 작성", vm.uiState.value.captureText)
        assertEquals("offline", vm.uiState.value.error)
        vm.capture()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(2, calls.size)
        assertEquals(calls[0], calls[1])
        assertEquals(timestamps[0], timestamps[1])
        coEvery { repository.capture(any(), any(), any(), any()) } returns ApiResult.Success(Todo("t", "금요일까지 논문 초안 작성"))
        vm.capture()
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("", vm.uiState.value.captureText)
        assertTrue(vm.uiState.value.captureSaved)
        verify(exactly = 1) { sync.notifyTodoChanged() }
    }

    @Test fun `switching workspace drops a capture answer from the old one`() = runTest {
        val answer = kotlinx.coroutines.CompletableDeferred<ApiResult<Todo>>()
        coEvery { repository.capture(scope, any(), any(), any()) } coAnswers { answer.await() }
        val vm = loaded()
        vm.editCapture("Renew the domain")
        vm.capture()
        dispatcher.scheduler.runCurrent()
        scopes.value = ExpectedSessionScope("server-b")
        dispatcher.scheduler.runCurrent()
        answer.complete(ApiResult.Success(Todo("t", "Renew the domain")))
        dispatcher.scheduler.advanceUntilIdle()
        assertFalse(vm.uiState.value.captureSaved)
        assertFalse(vm.uiState.value.capturing)
        verify(exactly = 0) { sync.notifyTodoChanged() }
    }
}
