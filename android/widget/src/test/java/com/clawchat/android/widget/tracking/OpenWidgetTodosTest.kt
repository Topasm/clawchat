package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.PaginatedResponse
import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import com.clawchat.android.core.network.ApiResult
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Test

class OpenWidgetTodosTest {
    @Test fun `both open statuses are filtered before pagination and merged`() = runTest {
        val requests = mutableListOf<Map<String, String>>()
        val result = loadOpenWidgetTodos(mapOf("limit" to "50", "due_before" to "2026-09-30T23:59:59")) { query ->
            requests += query
            val task = if (query["status"] == "pending") Todo("p", "Pending")
                else Todo("r", "Running", status = TaskStatus.IN_PROGRESS)
            ApiResult.Success(PaginatedResponse(items = listOf(task), total = 1))
        } as ApiResult.Success
        assertEquals(setOf("pending", "in_progress"), requests.map { it["status"] }.toSet())
        assertTrue(requests.all { it["limit"] == "50" && it.containsKey("due_before") })
        assertEquals(setOf("p", "r"), result.data.items.map { it.id }.toSet())
    }

    @Test fun `partial failure does not silently drop an entire task status`() = runTest {
        val result = loadOpenWidgetTodos(emptyMap()) { query ->
            if (query["status"] == "pending") ApiResult.Success(PaginatedResponse(items = listOf(Todo("p", "Pending")), total = 1))
            else ApiResult.Error("offline")
        }
        assertTrue(result is ApiResult.Error)
    }

    @Test fun `defensive filtering excludes closed rows from older servers`() = runTest {
        val result = loadOpenWidgetTodos(emptyMap()) {
            ApiResult.Success(PaginatedResponse(items = listOf(Todo("p", "Pending"),
                Todo("done", "Done", status = TaskStatus.COMPLETED)), total = 2))
        } as ApiResult.Success
        assertEquals(listOf("p"), result.data.items.map { it.id })
    }
}
