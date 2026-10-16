package com.clawchat.android.widget.tracking

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
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
        assertEquals(1f, byId.getValue("week").runwayFraction!!, 0.001f)
        assertEquals(0f, byId.getValue("today").runwayFraction!!, 0.001f)
        // Nothing is left of an overdue task's runway; the line reads as past
        // the deadline rather than as an empty, invisible bar.
        assertEquals(1f, byId.getValue("late").runwayFraction!!, 0.001f)
        assertTrue(byId.getValue("late").isOverdue)
        assertFalse(byId.getValue("today").isOverdue)
    }

    @Test
    fun `finished work and inbox captures are not widget rows`() {
        val result = model(
            listOf(
                todo(id = "done", status = TaskStatus.COMPLETED, dueDate = "2026-09-11T23:59:00"),
                todo(id = "cancelled", status = TaskStatus.CANCELLED, dueDate = "2026-09-11T23:59:00"),
                todo(id = "captured", dueDate = "2026-09-11T23:59:00", inboxState = "captured"),
                todo(id = "captured-undated", dueDate = null, inboxState = "captured"),
            ),
        )

        assertTrue(result.isEmpty)
        assertNull(result.nextDeadline)
    }

    // A deadline list alone hid every open task without a date, and the widget
    // read as broken. Those come back below the runway, without a runway line.
    @Test
    fun `in progress and undated work follow the runway`() {
        val result = model(
            listOf(
                todo(id = "undated-old", dueDate = null, updatedAt = "2026-09-01T00:00:00Z"),
                todo(id = "undated-new", dueDate = null, updatedAt = "2026-09-09T00:00:00Z"),
                todo(id = "running-far", status = TaskStatus.IN_PROGRESS, dueDate = "2026-10-01T23:59:00"),
                todo(id = "running", status = TaskStatus.IN_PROGRESS, dueDate = null),
                todo(id = "unreadable", dueDate = "not a date", updatedAt = "2026-08-01T00:00:00Z"),
                todo(id = "soon", dueDate = "2026-09-12T23:59:00"),
            ),
        )

        assertEquals(listOf("soon"), result.deadlines.map { it.id })
        assertEquals(
            listOf("running-far", "running", "undated-new", "undated-old", "unreadable"),
            result.others.map { it.id },
        )
        val byId = result.others.associateBy { it.id }
        assertEquals(21, byId.getValue("running-far").daysRemaining)
        assertNull(byId.getValue("running").daysRemaining)
        assertTrue(result.others.all { it.runwayFraction == null })
        assertEquals(6, result.itemCount)
    }

    @Test
    fun `the first pending deadline past the horizon is named, not listed`() {
        val result = model(
            listOf(
                todo(id = "later", title = "Later", dueDate = "2026-10-20T23:59:00"),
                todo(id = "gpu", title = "GPU homework", dueDate = "2026-09-28T23:59:00"),
                // Already a row with its own D-day, so it is not repeated.
                todo(id = "running", status = TaskStatus.IN_PROGRESS, dueDate = "2026-09-20T23:59:00"),
            ),
        )

        assertEquals(listOf("running"), result.items.map { it.id })
        val next = result.nextDeadline!!
        assertEquals("GPU homework", next.title)
        assertEquals(LocalDate.of(2026, 9, 28), next.dueDate)
        assertEquals(18, next.daysRemaining)
    }

    @Test
    fun `undated backlog is capped to the most recently touched`() {
        val result = model(
            (1..30).map { todo(id = "t$it", updatedAt = "2026-09-%02dT00:00:00Z".format(it)) },
        )

        assertEquals(TodoWidgetUiModel.MAX_OTHER_ROWS, result.others.size)
        assertEquals("t30", result.others.first().id)
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

    private fun todo(
        id: String,
        title: String = "Task $id",
        status: TaskStatus = TaskStatus.PENDING,
        dueDate: String? = null,
        inboxState: String? = "none",
        updatedAt: String = "",
    ) = Todo(
        id = id,
        title = title,
        status = status,
        dueDate = dueDate,
        inboxState = inboxState,
        updatedAt = updatedAt,
    )
}
