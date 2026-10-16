package com.clawchat.android.feature.inbox

import com.clawchat.android.core.data.ActiveSession
import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.SessionStore
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.InboxRouting
import com.clawchat.android.core.data.model.ProjectPlan
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.repository.InboxRoutingRepository
import com.clawchat.android.core.data.repository.InboxSnapshot
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class InboxViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private val repository = mockk<InboxRoutingRepository>()
    private val todos = mockk<TodoRepository>()
    private val sync = mockk<SyncManager>(relaxed = true)
    private val runtime = MutableStateFlow(
        AppRuntimeState(WorkspaceMode.SERVER, ActiveSession("token", "https://home.example", null, "manual"), true, "home"),
    )
    private val sessions = mockk<SessionStore> { every { runtimeState } returns runtime }

    private val filedTask = InboxRouting(
        id = "r1", origin = "auto", kind = "task", todoId = "t1", title = "Send the slides",
        originalTitle = "Send the slides Friday", dueDate = "2030-11-03T00:00:00Z", createdAt = "2030-11-01T09:00:00Z",
    )
    private val filedNote = InboxRouting(
        id = "r2", origin = "auto", kind = "note", noteId = "n1", title = "Idea for the offsite",
        originalTitle = "Idea for the offsite", createdAt = "2030-11-01T09:01:00Z",
    )
    private val unsure = Todo(id = "c1", title = "Call about the lease", inboxState = "captured")
    private val reading = Todo(id = "c2", title = "Something just captured", inboxState = "classifying")
    private val failed = Todo(id = "c3", title = "Renew the domain", inboxState = "error")
    private val snapshot = InboxSnapshot(
        routings = listOf(filedTask, filedNote),
        captures = listOf(reading, failed, unsure),
        projectOf = mapOf("t1" to "p1"),
        projects = listOf(ProjectPlan("p1", "Thesis"), ProjectPlan("p2", "Admin")),
    )

    @Before
    fun setup() {
        Dispatchers.setMain(dispatcher)
        every { sync.todoChanged } returns MutableSharedFlow()
        coEvery { repository.load("home") } returns ApiResult.Success(snapshot)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun loaded(): InboxViewModel {
        val vm = InboxViewModel(repository, todos, sync, sessions)
        dispatcher.scheduler.advanceUntilIdle()
        return vm
    }

    @Test
    fun `loads what was just organized and what still needs a look`() = runTest {
        val vm = loaded()
        val state = vm.uiState.value
        assertFalse(state.isLoading)
        assertEquals(listOf("r1", "r2"), state.routings.map { it.id })
        assertEquals(listOf("c2", "c3", "c1"), state.captures.map { it.id })
        assertNull(state.error)
    }

    @Test
    fun `a load error is shown`() = runTest {
        coEvery { repository.load("home") } returns ApiResult.Error("Network error")
        val vm = loaded()
        assertFalse(vm.uiState.value.isLoading)
        assertEquals("Network error", vm.uiState.value.error)
    }

    @Test
    fun `undo takes the move back and reloads`() = runTest {
        coEvery { repository.undo("home", "r1") } returns ApiResult.Success(filedTask)
        val vm = loaded()
        vm.onAction(InboxAction.Undo("r1"))
        dispatcher.scheduler.advanceUntilIdle()
        coVerifyOrder {
            repository.undo("home", "r1")
            repository.load("home")
        }
        coVerify(exactly = 2) { repository.load("home") }
    }

    @Test
    fun `switching kind turns a filed task into a note and a filed note into a task`() = runTest {
        coEvery { repository.toNote("home", "t1") } returns ApiResult.Success(filedNote)
        coEvery { repository.noteToTask("home", "n1") } returns ApiResult.Success(filedTask)
        val vm = loaded()
        vm.onAction(InboxAction.SwitchKind(filedTask))
        dispatcher.scheduler.advanceUntilIdle()
        vm.onAction(InboxAction.SwitchKind(filedNote))
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { repository.toNote("home", "t1") }
        coVerify(exactly = 1) { repository.noteToTask("home", "n1") }
    }

    @Test
    fun `moving to a project places a task and moves a note, and skips the project it is already in`() = runTest {
        coEvery { repository.placeTask("home", "t1", "p2") } returns ApiResult.Success(mockk(relaxed = true))
        coEvery { repository.moveNote("home", "n1", "p2") } returns ApiResult.Success(mockk(relaxed = true))
        val vm = loaded()
        vm.onAction(InboxAction.MoveToProject(filedTask, "p1"))
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 0) { repository.placeTask(any(), any(), any()) }
        vm.onAction(InboxAction.MoveToProject(filedTask, "p2"))
        dispatcher.scheduler.advanceUntilIdle()
        vm.onAction(InboxAction.MoveToProject(filedNote, "p2"))
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { repository.placeTask("home", "t1", "p2") }
        coVerify(exactly = 1) { repository.moveNote("home", "n1", "p2") }
    }

    @Test
    fun `a capture files as a task or a note`() = runTest {
        coEvery { repository.fileAsTask("home", "c1") } returns ApiResult.Success(filedTask)
        coEvery { repository.toNote("home", "c3") } returns ApiResult.Success(filedNote)
        val vm = loaded()
        vm.onAction(InboxAction.FileAsTask("c1"))
        dispatcher.scheduler.advanceUntilIdle()
        vm.onAction(InboxAction.FileAsNote("c3"))
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { repository.fileAsTask("home", "c1") }
        coVerify(exactly = 1) { repository.toNote("home", "c3") }
    }

    @Test
    fun `a second move waits for the first`() = runTest {
        val pending = CompletableDeferred<ApiResult<InboxRouting>>()
        coEvery { repository.fileAsTask("home", "c1") } coAnswers { pending.await() }
        val vm = loaded()
        vm.onAction(InboxAction.FileAsTask("c1"))
        dispatcher.scheduler.runCurrent()
        assertTrue(vm.uiState.value.busy)
        vm.onAction(InboxAction.FileAsNote("c3"))
        pending.complete(ApiResult.Success(filedTask))
        dispatcher.scheduler.advanceUntilIdle()
        assertFalse(vm.uiState.value.busy)
        coVerify(exactly = 0) { repository.toNote(any(), any()) }
    }

    @Test
    fun `a failed move says so and still reloads`() = runTest {
        coEvery { repository.toNote("home", "t1") } returns ApiResult.Error("Cannot move a task with steps", 409)
        val vm = loaded()
        vm.onAction(InboxAction.SwitchKind(filedTask))
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("Cannot move a task with steps", vm.uiState.value.error)
        coVerify(exactly = 2) { repository.load("home") }
    }

    @Test
    fun `a long press selects captures the classifier is not reading`() = runTest {
        val vm = loaded()
        vm.onAction(InboxAction.ToggleSelected("c1"))
        vm.onAction(InboxAction.ToggleSelected("c2"))
        assertEquals(listOf("c1"), vm.uiState.value.selection)
        vm.onAction(InboxAction.SelectAll)
        assertEquals(listOf("c3", "c1"), vm.uiState.value.selection)
        vm.onAction(InboxAction.ToggleSelected("c3"))
        assertEquals(listOf("c1"), vm.uiState.value.selection)
        vm.onAction(InboxAction.ClearSelection)
        assertTrue(vm.uiState.value.selection.isEmpty())
    }

    @Test
    fun `filing a selection moves each capture in turn and reloads once`() = runTest {
        coEvery { repository.toNote("home", any()) } returns ApiResult.Success(filedNote)
        val vm = loaded()
        vm.onAction(InboxAction.SelectAll)
        vm.onAction(InboxAction.FileSelection(asTask = false))
        assertTrue(vm.uiState.value.selected.isEmpty())
        dispatcher.scheduler.advanceUntilIdle()
        coVerifyOrder {
            repository.toNote("home", "c3")
            repository.toNote("home", "c1")
            repository.load("home")
        }
        coVerify(exactly = 2) { repository.load("home") }
    }

    @Test
    fun `deleting a capture hides it at once and brings it back if the server refuses`() = runTest {
        val pending = CompletableDeferred<ApiResult<Unit>>()
        coEvery { todos.deleteTodo("c1", any()) } coAnswers { pending.await() }
        val vm = loaded()
        vm.onAction(InboxAction.ToggleSelected("c1"))
        vm.onAction(InboxAction.Delete("c1"))
        dispatcher.scheduler.runCurrent()
        assertEquals(listOf("c2", "c3"), vm.uiState.value.captures.map { it.id })
        assertTrue(vm.uiState.value.selection.isEmpty())
        pending.complete(ApiResult.Error("Server error"))
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals(listOf("c2", "c3", "c1"), vm.uiState.value.captures.map { it.id })
        assertEquals("Server error", vm.uiState.value.error)
    }

    @Test
    fun `switching workspace drops the old lists and a late answer from the old one`() = runTest {
        val late = CompletableDeferred<ApiResult<InboxSnapshot>>()
        coEvery { repository.load("home") } coAnswers { late.await() }
        coEvery { repository.load("office") } returns ApiResult.Success(InboxSnapshot())
        val vm = InboxViewModel(repository, todos, sync, sessions)
        dispatcher.scheduler.runCurrent()
        runtime.value = runtime.value.copy(workspaceKey = "office")
        dispatcher.scheduler.runCurrent()
        late.complete(ApiResult.Success(snapshot))
        dispatcher.scheduler.advanceUntilIdle()
        assertTrue(vm.uiState.value.isEmpty)
        assertFalse(vm.uiState.value.isLoading)
    }
}
