package com.clawchat.android.feature.tasks

import com.clawchat.android.core.data.model.*
import com.clawchat.android.core.data.repository.ConversationRepository
import com.clawchat.android.core.data.repository.ProjectPlanRepository
import com.clawchat.android.core.data.repository.AgentRunRepository
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import io.mockk.every
import kotlinx.coroutines.*
import kotlinx.coroutines.test.*
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class ProjectPlanViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val repository = mockk<ProjectPlanRepository>()
    private val conversations = mockk<ConversationRepository>()
    private val runs = mockk<AgentRunRepository>()
    private val project = ProjectPlan("project", "Demo", rootTaskId = "different-root", conversationId = "canonical")
    private val ready = ProjectNode("ready", "Ready", "different-root", "descendant", "ready", true)

    @Before fun setup() {
        Dispatchers.setMain(dispatcher)
        coEvery { runs.getRun(any()) } returns ApiResult.Error("Unavailable")
        coEvery { repository.list() } returns ApiResult.Success(listOf(project))
        coEvery { repository.project("project") } returns ApiResult.Success(project)
        coEvery { repository.graph("different-root") } returns ApiResult.Success(ProjectGraph(listOf(
            ready, ready.copy(id = "external", scopeRole = "context"),
            ready.copy(id = "different-root", scopeRole = "root"),
        )))
    }
    @After fun cleanup() { Dispatchers.resetMain() }
    private fun selected(): ProjectPlanViewModel {
        val vm = ProjectPlanViewModel(repository, conversations, runs)
        dispatcher.scheduler.advanceUntilIdle()
        vm.select(project)
        dispatcher.scheduler.advanceUntilIdle()
        return vm
    }

    @Test fun `project uses root task graph and excludes prerequisite context from plan`() = runTest {
        val vm = selected()
        assertEquals(listOf("ready"), vm.uiState.value.nodes.map { it.id })
        coVerify(exactly = 1) { repository.graph("different-root") }
        vm.discuss()
        assertEquals("canonical", vm.uiState.value.openConversation)
        coVerify(exactly = 0) { conversations.getOrCreateForTodo(any()) }
    }

    @Test fun `ready run is explicit and duplicate submissions are suppressed`() = runTest {
        val vm = selected()
        coEvery { repository.run("ready") } returns ApiResult.Success(ReadyRunResult("run"))
        vm.run("external")
        coVerify(exactly = 0) { repository.run(any()) }
        vm.run("ready")
        vm.run("ready")
        dispatcher.scheduler.advanceUntilIdle()
        coVerify(exactly = 1) { repository.run("ready") }
        assertEquals("run", vm.uiState.value.openRun)
        assertFalse(vm.uiState.value.busy)
        assertEquals("""{"require_ready":true,"approved":true}""", Json.encodeToString(ReadyRunRequest(true, true)))
    }

    @Test fun `late project read cannot restore a closed project`() = runTest {
        val delayed = CompletableDeferred<ApiResult<ProjectGraph>>()
        coEvery { repository.graph("different-root") } coAnswers { withContext(NonCancellable) { delayed.await() } }
        val vm = ProjectPlanViewModel(repository, conversations, runs)
        dispatcher.scheduler.advanceUntilIdle()
        vm.select(project)
        dispatcher.scheduler.runCurrent()
        vm.select(null)
        delayed.complete(ApiResult.Success(ProjectGraph(listOf(ready))))
        dispatcher.scheduler.advanceUntilIdle()
        assertNull(vm.uiState.value.project)
        assertTrue(vm.uiState.value.nodes.isEmpty())
    }

    @Test fun `outline uses containment and safely includes malformed cycles once`() {
        val a = ready.copy(id = "a", parentId = "b")
        val b = ready.copy(id = "b", parentId = "a")
        assertEquals(listOf("a", "b"), projectOutline(listOf(a, b)).map { it.first.id })
        val child = ready.copy(id = "child", parentId = "ready", blockers = listOf("external"))
        assertEquals(listOf(0, 1), projectOutline(listOf(child, ready)).map { it.second })
    }

    @Test fun `execution opens its own conversation without creating a task chat`() = runTest {
        val vm = selected()
        val run = mockk<AgentRun>()
        every { run.conversationId } returns "execution-thread"
        coEvery { runs.getRun("run") } returns ApiResult.Success(run)
        coEvery { repository.run("ready") } returns ApiResult.Success(ReadyRunResult("run"))
        vm.run("ready")
        dispatcher.scheduler.advanceUntilIdle()
        assertEquals("execution-thread", vm.uiState.value.openConversation)
        assertEquals("Demo › Ready", vm.uiState.value.conversationTitle)
        assertNull(vm.uiState.value.openRun)
        coVerify(exactly = 0) { conversations.getOrCreateForTodo(any()) }
    }

    @Test fun `finished branches hide but ancestors of unfinished work remain`() {
        val parent = ready.copy(id = "parent", executionState = "completed", isReady = false)
        val child = ready.copy(id = "child", parentId = "parent")
        val done = ready.copy(id = "done", executionState = "completed", isReady = false)
        val nodes = listOf(parent, child, done)
        assertEquals(listOf("parent", "child"), visibleProjectOutline(nodes, emptySet(), false).map { it.first.id })
        assertEquals(listOf("parent"), visibleProjectOutline(nodes, setOf("parent"), false).map { it.first.id })
        assertEquals(3, visibleProjectOutline(nodes, emptySet(), true).size)
    }
}
