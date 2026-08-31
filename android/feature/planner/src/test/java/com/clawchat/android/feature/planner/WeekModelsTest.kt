package com.clawchat.android.feature.planner

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WeekModelsTest {

    @Test
    fun `week range follows the locale first weekday`() {
        val date = LocalDate.of(2026, 9, 3)

        assertEquals(
            WeekRange(LocalDate.of(2026, 8, 31), LocalDate.of(2026, 9, 6)),
            weekRange(date, DayOfWeek.MONDAY),
        )
        assertEquals(
            WeekRange(LocalDate.of(2026, 8, 30), LocalDate.of(2026, 9, 5)),
            weekRange(date, DayOfWeek.SUNDAY),
        )
    }

    @Test
    fun `range includes both boundary dates`() {
        val range = WeekRange(LocalDate.of(2026, 8, 31), LocalDate.of(2026, 9, 6))

        assertTrue(LocalDate.of(2026, 8, 31) in range)
        assertTrue(LocalDate.of(2026, 9, 6) in range)
        assertFalse(LocalDate.of(2026, 8, 30) in range)
        assertFalse(LocalDate.of(2026, 9, 7) in range)
    }

    @Test
    fun `grouping keeps active organized tasks and separates overdue`() {
        val range = WeekRange(LocalDate.of(2026, 8, 31), LocalDate.of(2026, 9, 6))
        val todos = listOf(
            todo("overdue", "2026-08-30", sortOrder = 2),
            todo("monday-second", "2026-08-31", sortOrder = 2),
            todo("monday-first", "2026-08-31", sortOrder = 1),
            todo("offset", "2026-09-01T23:30:00Z"),
            todo("done", "2026-09-02", status = TaskStatus.COMPLETED),
            todo("inbox", "2026-09-03", inboxState = "captured"),
            todo("future", "2026-09-07"),
            todo("undated", null),
        )

        val groups = groupWeekTasks(todos, range, ZoneId.of("Asia/Seoul"))

        assertEquals(listOf("overdue"), groups.overdue.map(Todo::id))
        assertEquals(
            listOf("monday-first", "monday-second"),
            groups.byDate[LocalDate.of(2026, 8, 31)]?.map(Todo::id),
        )
        assertEquals(
            listOf("offset"),
            groups.byDate[LocalDate.of(2026, 9, 2)]?.map(Todo::id),
        )
        assertEquals(3, groups.byDate.values.sumOf(List<Todo>::size))
    }

    private fun todo(
        id: String,
        dueDate: String?,
        status: TaskStatus = TaskStatus.PENDING,
        sortOrder: Int = 0,
        inboxState: String? = "none",
    ) = Todo(
        id = id,
        title = id,
        dueDate = dueDate,
        status = status,
        sortOrder = sortOrder,
        inboxState = inboxState,
    )
}
