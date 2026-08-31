package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.TodayResponse
import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TodoWidgetUiModelTest {

    @Test
    fun `projects active tasks and lets overdue placement win duplicates`() {
        val response = TodayResponse(
            overdueTodos = listOf(
                todo(id = "late", title = "Late", priority = "urgent"),
                todo(id = "duplicate", title = "Duplicate"),
            ),
            todayTodos = listOf(
                todo(id = "duplicate", title = "Duplicate"),
                todo(id = "today", title = "Today", status = TaskStatus.IN_PROGRESS),
            ),
        )

        val model = TodoWidgetUiModel.from(response)

        assertEquals(listOf("late", "duplicate"), model.overdue.map { it.id })
        assertEquals(listOf("today"), model.today.map { it.id })
        assertTrue(model.overdue.first().isHighPriority)
        assertTrue(model.overdue.all { it.isOverdue })
        assertEquals(3, model.itemCount)
    }

    @Test
    fun `completed and cancelled tasks are not actionable widget rows`() {
        val response = TodayResponse(
            todayTodos = listOf(
                todo(id = "done", title = "Done", status = TaskStatus.COMPLETED),
                todo(id = "cancelled", title = "Cancelled", status = TaskStatus.CANCELLED),
            ),
        )

        assertTrue(TodoWidgetUiModel.from(response).isEmpty)
    }

    private fun todo(
        id: String,
        title: String,
        status: TaskStatus = TaskStatus.PENDING,
        priority: String = "medium",
    ) = Todo(id = id, title = title, status = status, priority = priority)
}
