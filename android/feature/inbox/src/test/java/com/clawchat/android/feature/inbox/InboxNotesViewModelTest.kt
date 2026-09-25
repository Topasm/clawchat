package com.clawchat.android.feature.inbox

import com.clawchat.android.core.data.*
import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.data.repository.*
import com.clawchat.android.core.network.ApiResult
import io.mockk.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.*
import org.junit.*
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class InboxNotesViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val repository = mockk<NoteRepository>()
    private val sessions = mockk<SessionStore>()
    private val runtime = MutableStateFlow(AppRuntimeState(WorkspaceMode.SERVER, null, true, "host-a"))
    private val note = Note("n1", "Memo\nFull content", null, "now", "now")
    private val snapshot = NoteSnapshot(listOf(note), listOf(ProjectPlan("p1", "Project")))

    @Before fun setup() {
        Dispatchers.setMain(dispatcher)
        every { sessions.runtimeState } returns runtime
        coEvery { repository.load(any()) } returns ApiResult.Success(snapshot)
    }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun `failed capture keeps draft and retries with the same key`() = runTest(dispatcher) {
        val requests = mutableListOf<NoteCreate>()
        coEvery { repository.create(any(), capture(requests)) } returns ApiResult.Error("offline")
        val vm = InboxNotesViewModel(repository, sessions)
        advanceUntilIdle(); vm.draft("New memo"); vm.create(); advanceUntilIdle()
        assertEquals("New memo", vm.state.value.draft)
        vm.create(); advanceUntilIdle()
        assertEquals(requests[0].idempotencyKey, requests[1].idempotencyKey)
    }

    @Test fun `project drop supports undo without replacing note contents`() = runTest(dispatcher) {
        coEvery { repository.move("host-a", "n1", "p1") } returns ApiResult.Success(note.copy(projectId = "p1"))
        coEvery { repository.move("host-a", "n1", null) } returns ApiResult.Success(note)
        val vm = InboxNotesViewModel(repository, sessions)
        advanceUntilIdle(); vm.move("n1", "p1"); advanceUntilIdle()
        assertEquals("n1" to null, vm.state.value.undoMove)
        vm.undo(); advanceUntilIdle()
        coVerify(exactly = 1) { repository.move("host-a", "n1", null) }
        coVerify(exactly = 0) { repository.edit(any(), any(), any()) }
        assertNull(vm.state.value.undoMove)
    }

    @Test fun `workspace change drops pending response and draft`() = runTest(dispatcher) {
        val pending = CompletableDeferred<ApiResult<Note>>()
        coEvery { repository.create(any(), any()) } coAnswers { pending.await() }
        val vm = InboxNotesViewModel(repository, sessions)
        advanceUntilIdle(); vm.draft("Private note"); vm.create(); runCurrent()
        coEvery { repository.load("host-b") } returns ApiResult.Success(NoteSnapshot(emptyList(), emptyList()))
        runtime.value = runtime.value.copy(workspaceKey = "host-b")
        runCurrent(); pending.complete(ApiResult.Success(note)); advanceUntilIdle()
        assertEquals("host-b", vm.state.value.workspace)
        assertEquals("", vm.state.value.draft)
        assertTrue(vm.state.value.notes.isEmpty())
    }
}
