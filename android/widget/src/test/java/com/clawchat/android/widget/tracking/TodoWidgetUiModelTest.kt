package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class TodoWidgetUiModelTest {

    private val today = LocalDate.of(2026, 9, 10)
    private val utc = ZoneId.of("UTC")

    private fun model(todos: List<Todo>, horizonDays: Int = 7) =
        TodoWidgetUiModel.from(todos, horizonDays, today = today, deviceZone = utc)

    @Test
    fun `the nearest deadline comes first`() {
        val result = model(
            listOf(
                todo(id = "next-week", dueDate = "2026-09-16T23:59:00"),
                todo(id = "late", dueDate = "2026-09-08T23:59:00"),
                todo(id = "today", dueDate = "2026-09-10T23:59:00"),
            ),
        )

        assertEquals(listOf("late", "today", "next-week"), result.items.map { it.id })
        assertEquals(listOf(-2, 0, 6), result.items.map { it.daysRemaining })
    }

    // The widget exists to surface work while there is still room to do it, so
    // the horizon is what decides whether a deadline is worth a row.
    @Test
    fun `deadlines past the horizon are left off`() {
        val result = model(
            listOf(
                todo(id = "inside", dueDate = "2026-09-17T23:59:00"),
                todo(id = "outside", dueDate = "2026-09-18T00:00:00"),
            ),
        )

        assertEquals(listOf("inside"), result.items.map { it.id })
    }

    @Test
    fun `a wider horizon reaches further out`() {
        val todos = listOf(todo(id = "far", dueDate = "2026-09-24T23:59:00"))

        assertTrue(model(todos, horizonDays = 7).isEmpty)
        assertEquals(listOf("far"), model(todos, horizonDays = 14).items.map { it.id })
    }

    @Test
    fun `runway shrinks as the deadline approaches and fills once it passes`() {
        val result = model(
            listOf(
                todo(id = "week", dueDate = "2026-09-17T23:59:00"),
                todo(id = "today", dueDate = "2026-09-10T23:59:00"),
                todo(id = "late", dueDate = "2026-09-07T23:59:00"),
            ),
        )

        val byId = result.items.associateBy { it.id }
        assertEquals(1f, byId.getValue("week").runwayFraction, 0.001f)
        assertEquals(0f, byId.getValue("today").runwayFraction, 0.001f)
        // Nothing is left of an overdue task's runway; the line reads as past
        // the deadline rather than as an empty, invisible bar.
        assertEquals(1f, byId.getValue("late").runwayFraction, 0.001f)
        assertTrue(byId.getValue("late").isOverdue)
        assertFalse(byId.getValue("today").isOverdue)
    }

    @Test
    fun `finished work, undated tasks and inbox captures are not widget rows`() {
        val result = model(
            listOf(
                todo(id = "done", status = TaskStatus.COMPLETED, dueDate = "2026-09-11T23:59:00"),
                todo(id = "cancelled", status = TaskStatus.CANCELLED, dueDate = "2026-09-11T23:59:00"),
                todo(id = "undated", dueDate = null),
                todo(id = "unreadable", dueDate = "not a date"),
                todo(id = "captured", dueDate = "2026-09-11T23:59:00", inboxState = "captured"),
            ),
        )

        assertTrue(result.isEmpty)
    }

    @Test
    fun `in progress work keeps its row and duplicates are shown once`() {
        val result = model(
            listOf(
                todo(id = "running", status = TaskStatus.IN_PROGRESS, dueDate = "2026-09-11T23:59:00"),
                todo(id = "running", status = TaskStatus.IN_PROGRESS, dueDate = "2026-09-11T23:59:00"),
            ),
        )

        assertEquals(listOf("running"), result.items.map { it.id })
        assertEquals(1, result.itemCount)
    }

    @Test
    fun `urgent and high priority tasks are marked`() {
        val result = model(
            listOf(
                todo(id = "urgent", priority = "urgent", dueDate = "2026-09-11T23:59:00"),
                todo(id = "normal", priority = "medium", dueDate = "2026-09-12T23:59:00"),
            ),
        )

        val byId = result.items.associateBy { it.id }
        assertTrue(byId.getValue("urgent").isHighPriority)
        assertFalse(byId.getValue("normal").isHighPriority)
    }

    private fun todo(
        id: String,
        title: String = "Task $id",
        status: TaskStatus = TaskStatus.PENDING,
        priority: String = "medium",
        dueDate: String? = null,
        inboxState: String? = "none",
    ) = Todo(
        id = id,
        title = title,
        status = status,
        priority = priority,
        dueDate = dueDate,
        inboxState = inboxState,
    )
}
