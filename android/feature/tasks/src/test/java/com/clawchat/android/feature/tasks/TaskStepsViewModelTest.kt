package com.clawchat.android.feature.tasks

import androidx.lifecycle.SavedStateHandle
import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.TaskRelationship
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TaskStepResponse
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoPath
import com.clawchat.android.core.data.repository.TaskFlowRepository
import com.clawchat.android.core.data.repository.TodoRepository
import com.clawchat.android.core.network.ApiResult
import com.clawchat.android.core.sync.SyncManager
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
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
    private val syncManager = mockk<SyncManager> {
        every { todoChanged } returns MutableSharedFlow(extraBufferCapacity = 1)
    }
    private val flowRepository = mockk<TaskFlowRepository> {
        coEvery { isServer() } returns false
        coEvery { dependencies() } returns ApiResult.Success(emptyList())
        coEvery { paths(any()) } returns ApiResult.Success(emptyList())
    }
    private val parent = Todo(id = "parent", title = "Paper", projectId = "project")
    private val child = Todo(id = "child", title = "Figure", parentId = parent.id)
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun `add binds parent and project and blocks duplicate clicks`() = runTest {
        val reply = CompletableDeferred<ApiResult<Todo>>()
        coEvery { repository.createTodo(any()) } coAnswers { reply.await() }
        val vm = TaskStepsViewModel(repository, SavedStateHandle(), syncManager, flowRepository)
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
        val vm = TaskStepsViewModel(repository, SavedStateHandle(), syncManager, flowRepository)
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
        val vm = TaskStepsViewModel(repository, SavedStateHandle(), syncManager, flowRepository)
        vm.load(parent.id)
        advanceUntilIdle()
        assertEquals(listOf(child, second), vm.steps.value.getValue(parent.id).items)
    }

    @Test fun `late parent response does not overwrite another task draft`() = runTest {
        val reply = CompletableDeferred<ApiResult<Todo>>()
        coEvery { repository.createTodo(any()) } coAnswers { reply.await() }
        val vm = TaskStepsViewModel(repository, SavedStateHandle(), syncManager, flowRepository)
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
        val vm = TaskStepsViewModel(repository, SavedStateHandle(mapOf("step:parent" to "Saved")), syncManager, flowRepository)
        vm.load(parent.id)
        advanceUntilIdle()
        assertEquals("Saved", vm.steps.value.getValue(parent.id).draft)
        assertFalse(vm.steps.value.getValue(parent.id).loading)
        vm.edit(parent.id, "  ")
        vm.add(parent)
        advanceUntilIdle()
        coVerify(exactly = 0) { repository.createTodo(any()) }
    }

    private fun dependsOn(source: String, target: String) = TaskRelationship(
        id = "$source-$target", sourceTaskId = source, targetTaskId = target, type = "depends_on",
        createdBy = "user", createdAt = "", updatedAt = "",
    )

    @Test fun `on a server a step is added through the flow and its order is loaded`() = runTest {
        val first = child.copy(id = "first")
        coEvery { flowRepository.isServer() } returns true
        coEvery { repository.listTodos(any()) } returns ApiResult.Success(PaginatedResponse(listOf(first), total = 1))
        coEvery { flowRepository.addStep(parent.id, "Figure") } returns
            ApiResult.Success(TaskStepResponse(todo = child, changeId = "steps_1"))
        coEvery { flowRepository.dependencies() } returns ApiResult.Success(
            listOf(dependsOn("child", "first"), dependsOn("first", "elsewhere"), dependsOn("other", "x")),
        )
        coEvery { flowRepository.paths(parent.id) } returns
            ApiResult.Success(listOf(TodoPath(id = "p", kind = "url", path = "https://example.com")))
        val vm = TaskStepsViewModel(repository, SavedStateHandle(), syncManager, flowRepository)
        vm.load(parent.id)
        advanceUntilIdle()
        vm.edit(parent.id, "Figure")
        vm.add(parent)
        advanceUntilIdle()

        coVerify(exactly = 0) { repository.createTodo(any()) }
        val state = vm.steps.value.getValue(parent.id)
        assertEquals(listOf(first, child), state.items)
        assertEquals(listOf(StepEdge(before = "first", after = "child")), state.edges)
        assertEquals(listOf("elsewhere"), state.outside)
        assertEquals("https://example.com", state.paths.single().path)
    }

    @Test fun `flow layout keeps the main line first, branches beside it, unordered apart`() {
        val read = Todo(id = "read", title = "Read", sortOrder = 0)
        val kernel = Todo(id = "kernel", title = "Kernel", sortOrder = 10)
        val profile = Todo(id = "profile", title = "Profile", sortOrder = 20)
        val report = Todo(id = "report", title = "Report", sortOrder = 30)
        val submit = Todo(id = "submit", title = "Submit", sortOrder = 40)
        val papers = Todo(id = "papers", title = "Papers", sortOrder = 50)
        val grid = layoutFlow(
            listOf(papers, submit, report, profile, kernel, read),
            listOf(
                StepEdge("read", "kernel"), StepEdge("kernel", "profile"), StepEdge("kernel", "report"),
                StepEdge("profile", "submit"), StepEdge("report", "submit"),
            ),
        )
        assertEquals(
            listOf(listOf("read"), listOf("kernel"), listOf("profile", "report"), listOf("submit")),
            grid.layers.map { layer -> layer.map { it.id } },
        )
        assertEquals(listOf("papers"), grid.unordered.map { it.id })
        assertEquals(listOf("only"), layoutFlow(listOf(Todo(id = "only", title = "Only")), emptyList()).layers.flatten().map { it.id })
    }

    @Test fun `done lead stops at the first open step`() {
        val done = (0..3).map { Todo(id = "d$it", title = "D$it", sortOrder = it, status = TaskStatus.COMPLETED) }
        val open = Todo(id = "open", title = "Open", sortOrder = 9)
        val edges = listOf(StepEdge("d0", "d1"), StepEdge("d1", "d2"), StepEdge("d2", "d3"), StepEdge("d3", "open"))
        assertEquals(setOf("d0", "d1", "d2", "d3"), doneLead(done + open, edges))
    }
}
