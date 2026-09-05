package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.AppRuntimeState
import com.clawchat.android.core.data.WorkspaceMode
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.widget.common.WidgetState
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.time.LocalDate

@OptIn(ExperimentalCoroutinesApi::class)
class TodoWidgetUpdatesTest {
    private val runtime = AppRuntimeState(WorkspaceMode.LOCAL, null, true, "local")

    @Test fun `active session reload removes completed tasks without reopening widget`() = runTest {
        val changes = MutableSharedFlow<Unit>()
        var task = Todo("t", "Paper", dueDate = LocalDate.now().toString())
        val states = mutableListOf<TodoWidgetSnapshot>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            observeTodoWidgetSnapshots(MutableStateFlow(runtime), changes) {
                TodoWidgetSnapshot(WidgetState.Success(TodoWidgetUiModel.from(listOf(task), 7)), "local")
            }.toList(states)
        }
        runCurrent()
        assertEquals(1, (states.last().state as WidgetState.Success).data.itemCount)
        task = task.copy(status = TaskStatus.COMPLETED)
        changes.emit(Unit)
        runCurrent()
        assertTrue((states.last().state as WidgetState.Success).data.isEmpty)
    }

    @Test fun `workspace switch replaces old titles with loading until new load finishes`() = runTest {
        val runtimeFlow = MutableStateFlow(runtime)
        val pending = CompletableDeferred<TodoWidgetSnapshot>()
        val states = mutableListOf<TodoWidgetSnapshot>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            observeTodoWidgetSnapshots(runtimeFlow) {
                if (runtimeFlow.value.workspaceKey == "local") {
                    TodoWidgetSnapshot(WidgetState.Success(TodoWidgetUiModel(emptyList())), "local")
                } else pending.await()
            }.toList(states)
        }
        runCurrent()
        runtimeFlow.value = runtime.copy(mode = WorkspaceMode.SERVER, workspaceKey = "server:b")
        runCurrent()
        assertEquals("server:b", states.last().workspaceKey)
        assertTrue(states.last().state is WidgetState.Loading)
        pending.complete(TodoWidgetSnapshot(WidgetState.Success(TodoWidgetUiModel(emptyList())), "server:b"))
        runCurrent()
        assertTrue(states.last().state is WidgetState.Success)
    }

    @Test fun `failed refresh can recover on the next update in the same composition`() = runTest {
        val changes = MutableSharedFlow<Unit>()
        var fail = true
        val states = mutableListOf<TodoWidgetSnapshot>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) {
            observeTodoWidgetSnapshots(MutableStateFlow(runtime), changes) {
                if (fail) error("offline")
                TodoWidgetSnapshot(WidgetState.Success(TodoWidgetUiModel(emptyList())), "local")
            }.toList(states)
        }
        runCurrent()
        assertTrue(states.last().state is WidgetState.Error)
        fail = false
        changes.emit(Unit)
        runCurrent()
        assertTrue(states.last().state is WidgetState.Success)
    }
}
