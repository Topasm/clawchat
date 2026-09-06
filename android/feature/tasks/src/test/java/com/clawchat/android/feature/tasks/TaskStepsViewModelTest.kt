package com.clawchat.android.feature.tasks

import androidx.lifecycle.SavedStateHandle
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class TaskStepsViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val repository = mockk<TodoRepository>()
    private val parent = Todo(id = "parent", title = "Paper", projectId = "project")
    private val child = Todo(id = "child", title = "Figure", parentId = parent.id)
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun `add binds parent and project and blocks duplicate clicks`() = runTest {
        val reply = CompletableDeferred<ApiResult<Todo>>()
        coEvery { repository.createTodo(any()) } coAnswers { reply.await() }
        val vm = TaskStepsViewModel(repository, SavedStateHandle())
        vm.edit(parent.id, " Figure ")
        vm.add(parent)
        vm.add(parent)
        runCurrent()
        assertTrue(vm.steps.value.getValue(parent.id).saving)
        assertEquals(" Figure ", vm.steps.value.getValue(parent.id).draft)
        reply.complete(ApiResult.Success(child))
        advanceUntilIdle()
        coVerify(exactly = 1) { repository.createTodo(match {
            it.parentId == parent.id && it.projectId == "project" && it.title == "Figure" && it.inboxState == "none"
        }) }
        assertEquals("", vm.steps.value.getValue(parent.id).draft)
        assertEquals(listOf(child), vm.steps.value.getValue(parent.id).items)
    }

    @Test fun `failed add retains draft and retries with same operation key`() = runTest {
        val requests = mutableListOf<TodoCreate>()
        coEvery { repository.createTodo(capture(requests)) } returnsMany listOf(ApiResult.Error("Offline"), ApiResult.Success(child))
        val vm = TaskStepsViewModel(repository, SavedStateHandle())
        vm.edit(parent.id, "Figure")
        vm.add(parent)
        advanceUntilIdle()
        assertEquals("Figure", vm.steps.value.getValue(parent.id).draft)
        vm.add(parent)
        advanceUntilIdle()
        assertNotNull(requests[0].idempotencyKey)
        assertEquals(requests[0].idempotencyKey, requests[1].idempotencyKey)
    }

    @Test fun `loads every child page independently of task list filter`() = runTest {
        val second = child.copy(id = "second")
        coEvery { repository.listTodos(match { it["parent_id"] == parent.id && it["page"] == "1" }) } returns
            ApiResult.Success(PaginatedResponse(listOf(child), total = 2))
        coEvery { repository.listTodos(match { it["parent_id"] == parent.id && it["page"] == "2" }) } returns
            ApiResult.Success(PaginatedResponse(listOf(second), total = 2))
        val vm = TaskStepsViewModel(repository, SavedStateHandle())
        vm.load(parent.id)
        advanceUntilIdle()
        assertEquals(listOf(child, second), vm.steps.value.getValue(parent.id).items)
    }

    @Test fun `late parent response does not overwrite another task draft`() = runTest {
        val reply = CompletableDeferred<ApiResult<Todo>>()
        coEvery { repository.createTodo(any()) } coAnswers { reply.await() }
        val vm = TaskStepsViewModel(repository, SavedStateHandle())
        vm.edit(parent.id, "Figure")
        vm.add(parent)
        runCurrent()
        vm.edit("other", "Unrelated")
        reply.complete(ApiResult.Success(child))
        advanceUntilIdle()
        assertEquals("Unrelated", vm.steps.value.getValue("other").draft)
        assertTrue(vm.steps.value.getValue("other").items.isEmpty())
    }

    @Test fun `restored draft survives load failure and blank add does nothing`() = runTest {
        coEvery { repository.listTodos(any()) } returns ApiResult.Error("Offline")
        val vm = TaskStepsViewModel(repository, SavedStateHandle(mapOf("step:parent" to "Saved")))
        vm.load(parent.id)
        advanceUntilIdle()
        assertEquals("Saved", vm.steps.value.getValue(parent.id).draft)
        assertFalse(vm.steps.value.getValue(parent.id).loading)
        vm.edit(parent.id, "  ")
        vm.add(parent)
        advanceUntilIdle()
        coVerify(exactly = 0) { repository.createTodo(any()) }
    }
}
