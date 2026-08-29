package com.clawchat.android.feature.calendar

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.YearMonth
import java.util.Locale

class CalendarMonthTest {

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

        assertEquals(expected, parseEventDateTime("2026-08-29T09:00:00"))
        assertEquals(expected, parseEventDateTime("2026-08-29T09:00:00+00:00"))
        assertEquals(
            LocalDate.of(2026, 8, 29).atStartOfDay(),
            parseEventDateTime("2026-08-29"),
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
        assertEquals("All day", eventTimeLabel("2026-08-29T00:00:00", null, isAllDay = true))
        assertEquals("09:00", eventTimeLabel("2026-08-29T09:00:00", null, isAllDay = false))
        assertEquals(
            "09:00 – 10:30",
            eventTimeLabel("2026-08-29T09:00:00", "2026-08-29T10:30:00", isAllDay = false),
        )
    }
}
