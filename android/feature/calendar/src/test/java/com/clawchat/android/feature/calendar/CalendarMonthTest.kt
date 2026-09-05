package com.clawchat.android.feature.calendar

import com.clawchat.android.core.data.model.TaskStatus
import com.clawchat.android.core.data.model.Todo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.YearMonth
import java.time.ZoneId
import java.util.Locale

class CalendarMonthTest {

    @Test
    fun `approved inbox date only deadlines stay on Friday in either device timezone`() {
        val deadline = "2026-09-04T23:59:59"
        for (zone in listOf("Asia/Seoul", "America/Los_Angeles")) {
            val deviceZone = ZoneId.of(zone)
            assertEquals(LocalDate.of(2026, 9, 4), eventDate(deadline, deviceZone))
            val days = taskSegmentsByDate(
                listOf(Todo(id = "inbox", title = "Paper draft", dueDate = deadline)),
                today = LocalDate.of(2026, 9, 2), deviceZone = deviceZone,
            )
            assertEquals(LocalDate.of(2026, 9, 4), days.keys.maxOrNull())
        }
    }

    @Test
    fun `the grid always covers six weeks starting on the chosen weekday`() {
        val grid = monthGrid(YearMonth.of(2026, 8), DayOfWeek.MONDAY)

        assertEquals(42, grid.size)
        assertEquals(DayOfWeek.MONDAY, grid.first().dayOfWeek)
        assertTrue(grid.first() <= LocalDate.of(2026, 8, 1))
        assertTrue(grid.last() >= LocalDate.of(2026, 8, 31))
    }

    @Test
    fun `a month starting on the first weekday keeps no leading days`() {
        // 2026-06-01 is a Monday.
        val grid = monthGrid(YearMonth.of(2026, 6), DayOfWeek.MONDAY)

        assertEquals(LocalDate.of(2026, 6, 1), grid.first())
    }

    @Test
    fun `a Sunday-first week shifts the leading days by one`() {
        val monday = monthGrid(YearMonth.of(2026, 8), DayOfWeek.MONDAY).first()
        val sunday = monthGrid(YearMonth.of(2026, 8), DayOfWeek.SUNDAY).first()

        assertEquals(DayOfWeek.SUNDAY, sunday.dayOfWeek)
        assertEquals(monday.minusDays(1), sunday)
    }

    @Test
    fun `weekday labels follow the grid order`() {
        val labels = weekdayLabels(DayOfWeek.MONDAY, Locale.ENGLISH)

        assertEquals(7, labels.size)
        assertEquals("M", labels.first())
    }

    @Test
    fun `timestamps parse with an offset, without one, and as a bare date`() {
        val expected = LocalDateTime.of(2026, 8, 29, 9, 0)
        val offsetValue = "2026-08-29T09:00:00+00:00"
        val expectedOffsetTime = OffsetDateTime.parse(offsetValue)
            .atZoneSameInstant(ZoneId.systemDefault())
            .toLocalDateTime()

        assertEquals(expected, parseEventDateTime("2026-08-29T09:00:00"))
        assertEquals(expectedOffsetTime, parseEventDateTime(offsetValue))
        assertEquals(
            LocalDate.of(2026, 8, 29).atStartOfDay(),
            parseEventDateTime("2026-08-29"),
        )
    }

    @Test
    fun `offset and zoned timestamps cross the date boundary in the device timezone`() {
        val seoul = ZoneId.of("Asia/Seoul")
        val expected = LocalDateTime.of(2026, 8, 30, 8, 30)

        assertEquals(
            expected,
            parseEventDateTime("2026-08-29T23:30:00Z", deviceZone = seoul),
        )
        assertEquals(
            expected,
            parseEventDateTime("2026-08-29T23:30:00Z[UTC]", deviceZone = seoul),
        )
        assertEquals(
            LocalDate.of(2026, 8, 30),
            eventDate("2026-08-29T23:30:00Z", deviceZone = seoul),
        )
    }

    @Test
    fun `an unreadable timestamp is dropped rather than guessed`() {
        assertNull(parseEventDateTime(null))
        assertNull(parseEventDateTime(""))
        assertNull(parseEventDateTime("not a date"))
        assertNull(eventDate("not a date"))
    }

    @Test
    fun `the time label covers all-day, open-ended, and bounded events`() {
        assertEquals(
            "All day",
            eventTimeLabel(
                "2026-08-29T00:00:00",
                null,
                isAllDay = true,
                allDayLabel = "All day",
            ),
        )
        assertEquals(
            "09:00",
            eventTimeLabel(
                "2026-08-29T09:00:00",
                null,
                isAllDay = false,
                allDayLabel = "All day",
            ),
        )
        assertEquals(
            "09:00 – 10:30",
            eventTimeLabel(
                "2026-08-29T09:00:00",
                "2026-08-29T10:30:00",
                isAllDay = false,
                allDayLabel = "All day",
            ),
        )
    }

    // --- deadlines on the grid ------------------------------------------

    private fun todo(
        id: String = "todo-1",
        title: String = "Ship the release",
        status: TaskStatus = TaskStatus.PENDING,
        dueDate: String? = null,
    ) = Todo(id = id, title = title, status = status, dueDate = dueDate)

    @Test
    fun `a task runs from today through its due date`() {
        val today = LocalDate.of(2026, 9, 10)

        val byDate = taskSegmentsByDate(
            listOf(todo(dueDate = "2026-09-12T23:59:00")),
            today = today,
            deviceZone = ZoneId.of("UTC"),
        )

        assertEquals(
            listOf(today, today.plusDays(1), today.plusDays(2)),
            byDate.keys.sorted(),
        )
        assertEquals(TaskSegmentPosition.START, byDate.getValue(today).single().position)
        assertEquals(
            TaskSegmentPosition.MIDDLE,
            byDate.getValue(today.plusDays(1)).single().position,
        )
        assertEquals(
            TaskSegmentPosition.END,
            byDate.getValue(today.plusDays(2)).single().position,
        )
    }

    @Test
    fun `a task due today collapses onto the single day`() {
        val today = LocalDate.of(2026, 9, 10)

        val byDate = taskSegmentsByDate(
            listOf(todo(dueDate = "2026-09-10T18:00:00")),
            today = today,
            deviceZone = ZoneId.of("UTC"),
        )

        assertEquals(listOf(today), byDate.keys.toList())
        assertEquals(TaskSegmentPosition.SINGLE, byDate.getValue(today).single().position)
        assertEquals(false, byDate.getValue(today).single().isOverdue)
    }

    // An overdue task has no stretch left to work in, so it must not paint
    // every day between the missed deadline and today.
    @Test
    fun `an overdue task shows only on the day it was due`() {
        val today = LocalDate.of(2026, 9, 10)

        val byDate = taskSegmentsByDate(
            listOf(todo(dueDate = "2026-09-07T23:59:00")),
            today = today,
            deviceZone = ZoneId.of("UTC"),
        )

        assertEquals(listOf(LocalDate.of(2026, 9, 7)), byDate.keys.toList())
        assertTrue(byDate.getValue(LocalDate.of(2026, 9, 7)).single().isOverdue)
    }

    @Test
    fun `finished work and tasks without a deadline stay off the grid`() {
        val byDate = taskSegmentsByDate(
            listOf(
                todo(id = "a", status = TaskStatus.COMPLETED, dueDate = "2026-09-11T23:59:00"),
                todo(id = "b", status = TaskStatus.CANCELLED, dueDate = "2026-09-11T23:59:00"),
                todo(id = "c", dueDate = null),
                todo(id = "d", dueDate = "not a date"),
            ),
            today = LocalDate.of(2026, 9, 10),
            deviceZone = ZoneId.of("UTC"),
        )

        assertTrue(byDate.isEmpty())
    }

    @Test
    fun `the soonest deadline comes first on a shared day`() {
        val today = LocalDate.of(2026, 9, 10)

        val byDate = taskSegmentsByDate(
            listOf(
                todo(id = "later", dueDate = "2026-09-20T23:59:00"),
                todo(id = "sooner", dueDate = "2026-09-11T23:59:00"),
            ),
            today = today,
            deviceZone = ZoneId.of("UTC"),
        )

        assertEquals(
            listOf("sooner", "later"),
            byDate.getValue(today).map { it.todo.id },
        )
    }
}
