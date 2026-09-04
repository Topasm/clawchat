package com.clawchat.android.core.data.local

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Test

class TodoMappersTest {
    @Test
    fun `server cache round trip preserves project execution context`() {
        val todo = Todo(
            id = "step-a",
            title = "E65a Run baseline",
            description = "Measure the planner boundary",
            projectId = "project-p0-r",
            status = TaskStatus.IN_PROGRESS,
            priority = "high",
            tags = listOf("exp/E65a", "branch/P0-R", "repo/srp"),
            parentId = "question-e65",
            sortOrder = 3,
            source = "obsidian",
            sourceId = "P0-R/TODO.md",
            idempotencyKey = "00000000-0000-0000-0000-000000000065",
            assignee = "agent",
            inboxState = "none",
            estimatedMinutes = 45,
            projectLabel = "P0-R Semantic referent binding",
            createdAt = "2026-09-04T00:00:00Z",
            updatedAt = "2026-09-04T01:00:00Z",
        )

        val restored = todo.toEntity("server:url:test").toModel()

        assertEquals(todo, restored)
    }
}
