package com.clawchat.android.feature.tasks

import androidx.lifecycle.SavedStateHandle
import com.clawchat.android.core.data.model.TaskComment
import com.clawchat.android.core.data.repository.TaskCommentRepository
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
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.test.resetMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.Assert.*

@OptIn(ExperimentalCoroutinesApi::class)
class TaskNotesViewModelTest {
    private val dispatcher = StandardTestDispatcher()
    private val repository = mockk<TaskCommentRepository>()
    private val saved = SavedStateHandle()
    private fun note(task: String) = TaskComment("note:$task", task, "saved", "user", "2026-09-06T00:00:00Z", "2026-09-06T00:00:00Z")
    @Before fun setup() { Dispatchers.setMain(dispatcher) }
    @After fun cleanup() { Dispatchers.resetMain() }

    @Test fun `save clears draft only after success and blocks duplicate clicks`() = runTest {
        val response = CompletableDeferred<ApiResult<TaskComment>>()
        coEvery { repository.addComment("a", "draft", any()) } coAnswers { response.await() }
        val vm = TaskNotesViewModel(repository, saved)
        vm.edit("a", "draft")
        vm.send("a")
        vm.send("a")
        runCurrent()
        assertEquals("draft", vm.notes.value["a"]?.draft)
        response.complete(ApiResult.Success(note("a")))
        advanceUntilIdle()
        assertEquals("", vm.notes.value["a"]?.draft)
        assertEquals(listOf(note("a")), vm.notes.value["a"]?.comments)
        coVerify(exactly = 1) { repository.addComment("a", "draft", any()) }
    }

    @Test fun `failed save keeps draft and retry succeeds`() = runTest {
        coEvery { repository.addComment("a", "draft", any()) } returns ApiResult.Error("Failed")
        val vm = TaskNotesViewModel(repository, saved)
        vm.edit("a", "draft")
        vm.send("a")
        advanceUntilIdle()
        assertEquals("draft", vm.notes.value["a"]?.draft)
        assertFalse(vm.notes.value["a"]!!.sending)
        coEvery { repository.addComment("a", "draft", any()) } returns ApiResult.Success(note("a"))
        vm.send("a")
        advanceUntilIdle()
        assertEquals("", vm.notes.value["a"]?.draft)
    }

    @Test fun `late response does not change another task draft`() = runTest {
        val response = CompletableDeferred<ApiResult<TaskComment>>()
        coEvery { repository.addComment("a", "first", any()) } coAnswers { response.await() }
        val vm = TaskNotesViewModel(repository, saved)
        vm.edit("a", "first")
        vm.send("a")
        runCurrent()
        vm.edit("b", "second")
        response.complete(ApiResult.Success(note("a")))
        advanceUntilIdle()
        assertEquals("second", vm.notes.value["b"]?.draft)
        assertTrue(vm.notes.value["b"]!!.comments.isEmpty())
    }

    @Test fun `reload restores saved draft and filters unrelated comments`() = runTest {
        saved["note:a"] = "restored"
        coEvery { repository.listForTodos(listOf("a")) } returns ApiResult.Success(listOf(note("b"), note("a")))
        val vm = TaskNotesViewModel(repository, saved)
        vm.load("a")
        advanceUntilIdle()
        assertEquals("restored", vm.notes.value["a"]?.draft)
        assertEquals(listOf(note("a")), vm.notes.value["a"]?.comments)
    }

    @Test fun `blank and oversized notes do not call the repository`() = runTest {
        val vm = TaskNotesViewModel(repository, saved)
        vm.edit("a", " ")
        vm.send("a")
        vm.edit("a", "x".repeat(4001))
        vm.send("a")
        advanceUntilIdle()
        coVerify(exactly = 0) { repository.addComment(any(), any(), any()) }
    }

    @Test fun `wrong task response preserves the draft`() = runTest {
        coEvery { repository.addComment("a", "draft", any()) } returns ApiResult.Success(note("b"))
        val vm = TaskNotesViewModel(repository, saved)
        vm.edit("a", "draft")
        vm.send("a")
        advanceUntilIdle()
        assertEquals("draft", vm.notes.value["a"]?.draft)
        assertNotNull(vm.notes.value["a"]?.sendError)
    }
}
