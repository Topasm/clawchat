package com.clawchat.android.core.data.repository

import com.clawchat.android.core.api.ClawChatApi
import com.clawchat.android.core.data.local.TodoDao
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.data.model.TodoCreate
import com.clawchat.android.core.data.model.TodoUpdate
import com.clawchat.android.core.network.ApiResult
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

class TodoRepositoryTest {
    private val api = mockk<ClawChatApi>()
    private val todoDao = mockk<TodoDao>(relaxed = true)
    private val repository = TodoRepositoryImpl(api, todoDao)

    @Test
    fun `successful quick add is written to Room`() = runTest {
        val request = TodoCreate(
            title = "Call Ada",
            source = "widget_quick_add",
            inboxState = "captured",
            idempotencyKey = "00000000-0000-0000-0000-000000000001",
        )
        coEvery { api.createTodo(request) } returns todo("todo-new", "Call Ada")

        val result = repository.createTodo(request)

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { rows ->
                rows.singleOrNull()?.id == "todo-new" && rows.single().title == "Call Ada"
            })
        }
    }

    @Test
    fun `successful completion replaces the cached task`() = runTest {
        val request = TodoUpdate(status = TaskStatus.COMPLETED)
        coEvery { api.updateTodo("todo-1", request) } returns
            todo("todo-1", "Ship widget", TaskStatus.COMPLETED)

        val result = repository.updateTodo("todo-1", request)

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) {
            todoDao.upsertAll(match { rows ->
                rows.singleOrNull()?.status == TaskStatus.COMPLETED.wireValue
            })
        }
    }

    @Test
    fun `successful delete removes the cached task`() = runTest {
        coEvery { api.deleteTodo("todo-1") } returns Unit

        val result = repository.deleteTodo("todo-1")

        assertTrue(result is ApiResult.Success)
        coVerify(exactly = 1) { todoDao.deleteById("todo-1") }
    }

    @Test
    fun `failed mutation leaves Room unchanged`() = runTest {
        coEvery { api.updateTodo(any(), any()) } throws IOException("offline")

        val result = repository.updateTodo(
            "todo-1",
            TodoUpdate(status = TaskStatus.COMPLETED),
        )

        assertTrue(result is ApiResult.Error)
        coVerify(exactly = 0) { todoDao.upsertAll(any()) }
        coVerify(exactly = 0) { todoDao.deleteById(any()) }
    }

    private fun todo(
        id: String,
        title: String,
        status: TaskStatus = TaskStatus.PENDING,
    ) = Todo(
        id = id,
        title = title,
        status = status,
        createdAt = "2026-08-31T00:00:00Z",
        updatedAt = "2026-08-31T00:00:00Z",
    )
}
